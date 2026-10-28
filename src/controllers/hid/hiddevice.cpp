#include "controllers/hid/hiddevice.h"

#include <hidapi.h>

#include <QDebugStateSaver>
#ifdef Q_OS_ANDROID
#include <QJniEnvironment>
#endif

#include "controllers/controllermappinginfo.h"
#include "util/path.h"
#include "util/string.h"

#ifndef Q_OS_ANDROID
namespace {

constexpr std::size_t kDeviceInfoStringMaxLength = 512;

PhysicalTransportProtocol hidapiBusType2PhysicalTransportProtocol(hid_bus_type busType) {
    switch (busType) {
    case HID_API_BUS_USB:
        return PhysicalTransportProtocol::USB;
    case HID_API_BUS_BLUETOOTH:
        return PhysicalTransportProtocol::BlueTooth;
    case HID_API_BUS_I2C:
        return PhysicalTransportProtocol::I2C;
    case HID_API_BUS_SPI:
        return PhysicalTransportProtocol::SPI;
    default:
        return PhysicalTransportProtocol::UNKNOWN;
    }
}

} // namespace
#endif

namespace mixxx {

namespace hid {

#ifndef Q_OS_ANDROID
DeviceInfo::DeviceInfo(const hid_device_info& device_info)
        : vendor_id(device_info.vendor_id),
          product_id(device_info.product_id),
          release_number(device_info.release_number),
          usage_page(device_info.usage_page),
          usage(device_info.usage),
          m_physicalTransportProtocol(hidapiBusType2PhysicalTransportProtocol(
                  device_info.bus_type)),
          m_usbInterfaceNumber(device_info.interface_number),
          m_pathRaw(device_info.path,
                  mixxx::strnlen_s(device_info.path, PATH_MAX)),
          m_serialNumberRaw(device_info.serial_number,
                  mixxx::wcsnlen_s(device_info.serial_number,
                          kDeviceInfoStringMaxLength)),
          m_manufacturerString(mixxx::convertWCStringToQString(
                  device_info.manufacturer_string, kDeviceInfoStringMaxLength)),
          m_productString(mixxx::convertWCStringToQString(
                  device_info.product_string, kDeviceInfoStringMaxLength)),
          m_serialNumber(mixxx::convertWCStringToQString(
                  m_serialNumberRaw.data(), m_serialNumberRaw.size())) {
}
#else
namespace {
QString usbStringOrEmpty(const QJniObject& usbDevice, const char* method) {
    QJniEnvironment env;
    const QJniObject value = usbDevice.callMethod<jstring>(method);
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        return {};
    }
    if (!value.isValid()) {
        return {};
    }
    return value.toString();
}
} // namespace

DeviceInfo::DeviceInfo(
        const QJniObject& usbDevice, const QJniObject& usbInterface)
        : m_androidUsbDevice(usbDevice),
          m_physicalTransportProtocol(PhysicalTransportProtocol::USB) {
    vendor_id = static_cast<unsigned short>(usbDevice.callMethod<jint>("getVendorId"));
    product_id = static_cast<unsigned short>(usbDevice.callMethod<jint>("getProductId"));
    m_androidDeviceName = usbStringOrEmpty(usbDevice, "getDeviceName");
    // Manufacturer, product and serial throw SecurityException until the user
    // grants USB permission. Enumeration must still succeed so we can ask.
    m_manufacturerString = usbStringOrEmpty(usbDevice, "getManufacturerName");
    m_productString = usbStringOrEmpty(usbDevice, "getProductName");
    m_serialNumber = usbStringOrEmpty(usbDevice, "getSerialNumber");

    if (m_serialNumber.isEmpty()) {
        m_serialNumber = QStringLiteral("N/A");
    }

    m_usbInterfaceNumber = usbInterface.callMethod<jint>("getId");
}
#endif

const std::vector<uint8_t>& DeviceInfo::fetchRawReportDescriptor(hid_device* pHidDevice) {
    if (!pHidDevice) {
        static const std::vector<uint8_t> emptyDescriptor;
        return emptyDescriptor;
    }
    if (!m_reportDescriptor.empty()) {
        //
        return m_reportDescriptor;
    }

    uint8_t tempReportDescriptor[HID_API_MAX_REPORT_DESCRIPTOR_SIZE];
    int descriptorSize = hid_get_report_descriptor(pHidDevice,
            tempReportDescriptor,
            HID_API_MAX_REPORT_DESCRIPTOR_SIZE);
    if (descriptorSize <= 0) {
        static const std::vector<uint8_t> emptyDescriptor;
        return emptyDescriptor;
    }
    m_reportDescriptor = std::vector<uint8_t>(tempReportDescriptor,
            tempReportDescriptor + descriptorSize);

    return m_reportDescriptor;
}

QString DeviceInfo::formatName() const {
    // We include the last 4 digits of the serial number and the
    // interface number to allow the user (and Mixxx!) to keep
    // track of which is which
    const auto serialSuffix = getSerialNumber().right(4);
    QString product = getProductString();
    if (product.isEmpty()) {
        product = QStringLiteral("USB HID %1:%2")
                          .arg(vendor_id, 4, 16, QLatin1Char('0'))
                          .arg(product_id, 4, 16, QLatin1Char('0'))
                          .toUpper();
    }
    if (m_usbInterfaceNumber >= 0) {
        return product +
                QChar(' ') +
                serialSuffix +
                QChar('_') +
                QString::number(m_usbInterfaceNumber);
    } else {
        return product +
                QChar(' ') +
                serialSuffix;
    }
}

QDebug operator<<(QDebug dbg, const DeviceInfo& deviceInfo) {
    const auto dbgState = QDebugStateSaver(dbg);
    dbg.nospace().noquote() << "{ ";

    auto formatHex = [](unsigned short value) {
        return QString::number(value, 16).toUpper().rightJustified(4, '0');
    };

    dbg << "VID:" << formatHex(deviceInfo.getVendorId())
        << " PID:" << formatHex(deviceInfo.getProductId()) << " | ";

    dbg << "Physical: "
        << Controller::physicalTransport2String(deviceInfo.getPhysicalTransportProtocol())
        << " | ";

    dbg << "Usage-Page: " << formatHex(deviceInfo.getUsagePage())
        << ' ' << deviceInfo.getUsagePageDescription() << " | ";

    dbg << "Usage: " << formatHex(deviceInfo.getUsage())
        << ' ' << deviceInfo.getUsageDescription() << " | ";

    if (deviceInfo.getUsbInterfaceNumber()) {
        dbg << "Interface: #" << deviceInfo.getUsbInterfaceNumber().value() << " | ";
    }
    if (!deviceInfo.getVendorString().isEmpty()) {
        dbg << "Manufacturer: " << deviceInfo.getVendorString() << " | ";
    }
    if (!deviceInfo.getProductString().isEmpty()) {
        dbg << "Product: " << deviceInfo.getProductString() << " | ";
    }
    if (!deviceInfo.getSerialNumber().isEmpty()) {
        dbg << "S/N: " << deviceInfo.getSerialNumber();
    }

    dbg << " }";
    return dbg;
}

bool DeviceInfo::matchProductInfo(
        const ProductInfo& product) const {
    bool ok = false;
    // Product and vendor match is always required
    if (vendor_id != product.vendor_id.toInt(&ok, 16) || !ok) {
        return false;
    }
    if (product_id != product.product_id.toInt(&ok, 16) || !ok) {
        return false;
    }

    // Interface number is optional in the mapping. The original Kontrol Z1
    // mapping declares only 17cc:1210. F1 (interface 1) and X1 Mk2 (interface 4)
    // declare an interface so a composite device does not open the wrong one.
    if (!product.interface_number.isEmpty()) {
        const int mappedInterface = product.interface_number.toInt(&ok, 16);
        if (!ok || m_usbInterfaceNumber != mappedInterface) {
            return false;
        }
        return true;
    }

#ifndef Q_OS_ANDROID
    // Usage page and usage are not available on Android until the device is
    // open, so a VID/PID-only mapping matches there. On desktop, honor them
    // when the mapping provides them.
    if (!product.usage_page.isEmpty() || !product.usage.isEmpty()) {
        if (usage_page != product.usage_page.toInt(&ok, 16) || !ok) {
            return false;
        }
        if (usage != product.usage.toInt(&ok, 16) || !ok) {
            return false;
        }
    }
#endif
    return true;
}

} // namespace hid

} // namespace mixxx
