# Generates Android res/xml/usb_device_filter.xml from shipped HID mappings.
# Invoked at build time with cmake -P, so CMAKE_SOURCE_DIR is passed explicitly.
#
# AI Agent disclaimer: this build script was drafted autonomously by an AI agent.
# AI Agent disclaimer end.

cmake_minimum_required(VERSION 3.21)

if(NOT TEMPLATE_FILE)
    message(FATAL_ERROR "TEMPLATE_FILE must be set")
endif()
if(NOT TARGET_FILE)
    message(FATAL_ERROR "TARGET_FILE must be set")
endif()
if(NOT SOURCE_DIR)
    message(FATAL_ERROR "SOURCE_DIR must be set")
endif()

file(GLOB HID_XML_FILES "${SOURCE_DIR}/res/controllers/*.hid.xml")

set(USB_DEVICE_ENTRIES "")
foreach(HID_XML_FILE ${HID_XML_FILES})
    get_filename_component(FILENAME "${HID_XML_FILE}" NAME)
    if(FILENAME STREQUAL "Dummy Device Screen.hid.xml")
        continue()
    endif()
    file(STRINGS "${HID_XML_FILE}" HID_LINES REGEX "protocol=\"hid\"")
    foreach(LINE ${HID_LINES})
        string(REGEX MATCH "vendor_id=\"([^\"]+)\"" _ "${LINE}")
        set(VID "${CMAKE_MATCH_1}")
        string(REGEX MATCH "product_id=\"([^\"]+)\"" _ "${LINE}")
        set(PID "${CMAKE_MATCH_1}")
        if(VID AND PID)
            string(REGEX REPLACE "^0[xX]" "" VID_HEX "${VID}")
            string(REGEX REPLACE "^0[xX]" "" PID_HEX "${PID}")
            math(EXPR VID_DEC "0x${VID_HEX}" OUTPUT_FORMAT DECIMAL)
            math(EXPR PID_DEC "0x${PID_HEX}" OUTPUT_FORMAT DECIMAL)
            set(ENTRY "    <usb-device vendor-id=\"${VID_DEC}\" product-id=\"${PID_DEC}\" />")
            list(FIND USB_DEVICE_ENTRIES "${ENTRY}" IDX)
            if(IDX EQUAL -1)
                list(APPEND USB_DEVICE_ENTRIES "${ENTRY}")
            endif()
        endif()
    endforeach()
endforeach()

list(SORT USB_DEVICE_ENTRIES)
string(REPLACE ";" "\n" USB_DEVICE_ENTRIES_STR "${USB_DEVICE_ENTRIES}")

file(READ "${TEMPLATE_FILE}" TEMPLATE_CONTENT)
string(
    REPLACE
    "    @USB_DEVICE_ENTRIES@"
    "${USB_DEVICE_ENTRIES_STR}"
    OUTPUT_CONTENT
    "${TEMPLATE_CONTENT}"
)
get_filename_component(TARGET_DIR "${TARGET_FILE}" DIRECTORY)
file(MAKE_DIRECTORY "${TARGET_DIR}")
file(WRITE "${TARGET_FILE}" "${OUTPUT_CONTENT}")
list(LENGTH USB_DEVICE_ENTRIES SUPPORTED_DEVICES_COUNT)
message(
    STATUS
    "Generated Android USB device filter with ${SUPPORTED_DEVICES_COUNT} HID devices."
)
