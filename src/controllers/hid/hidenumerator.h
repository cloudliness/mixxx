#pragma once

#include <QHash>

#include "controllers/controllerenumerator.h"
#include "controllers/hid/hiddevice.h"

/// This class handles discovery and enumeration of DJ controllers that use the
/// USB-HID protocol.
class HidEnumerator : public ControllerEnumerator {
    Q_OBJECT
  public:
    HidEnumerator() = default;
    ~HidEnumerator() override;

    QList<Controller*> queryDevices() override;

  private:
    QList<Controller*> m_devices;
#ifdef __ANDROID__
    // Same pointers as m_devices. Kept so a USB refresh can reuse an already
    // opened controller instead of constructing a second one. Stale devices
    // stay owned by m_devices until shutdown; deleting them races the QML
    // proxies that still hold the pointer until devicesChanged is handled.
    QHash<QString, Controller*> m_devicesByKey;
#endif
};
