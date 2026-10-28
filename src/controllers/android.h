#pragma once

#include <functional>
#include <vector>

struct libusb_context;

namespace mixxx {
namespace android {

const QJniObject& getIntent();
bool waitForPermission(const QJniObject& device);
void usbDeviceAccessResult(QJniObject device, bool granted);

// Called on the Qt GUI thread when a supported USB device is attached or
// detached. Controller enumeration is not safe until ControllerManager has
// finished slotInitialize(); the handler may no-op and retry later.
void setUsbHotplugHandler(std::function<void()> handler);
void notifyUsbDevicesChanged();

// Called on the Qt GUI thread after the original Kontrol Z1 (17cc:1210) HID
// interface has been opened, so the audio backend can claim channels 1-2 and 3-4.
void setZ1AudioHandler(std::function<void()> handler);
void notifyZ1AudioReady();

extern std::mutex s_androidLock;
extern std::condition_variable s_grantingWaitCond;
extern std::vector<std::pair<QJniObject, bool>> s_grantingResult;
extern QJniObject s_intent;
extern QJniObject s_usbManager;

} // namespace android
} // namespace mixxx
