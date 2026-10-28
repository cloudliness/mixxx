#include "android.h"

#include <android/api-level.h>
#include <android/log.h>
#include <qjnitypes.h>

#include <QCoreApplication>
#include <QThread>
#include <QtJniTypes>
#include <cstddef>

namespace {
std::function<void()> s_hotplugHandler;
bool s_pendingHotplug = false;
std::function<void()> s_z1AudioHandler;
bool s_pendingZ1Audio = false;

void dispatchOnGuiThread(const std::function<void()>& function) {
    QCoreApplication* app = QCoreApplication::instance();
    if (app && QThread::currentThread() != app->thread()) {
        QMetaObject::invokeMethod(app, function, Qt::QueuedConnection);
        return;
    }
    function();
}
} // namespace

namespace mixxx {
namespace android {
std::mutex s_androidLock = {};
std::condition_variable s_grantingWaitCond = {};
std::vector<std::pair<QJniObject, bool>> s_grantingResult = {};
QJniObject s_intent = {};
QJniObject s_usbManager = {};

void setUsbHotplugHandler(std::function<void()> handler) {
    std::unique_lock lock(s_androidLock);
    s_hotplugHandler = std::move(handler);
    const bool pending = s_pendingHotplug;
    s_pendingHotplug = false;
    lock.unlock();
    if (pending && s_hotplugHandler) {
        dispatchOnGuiThread(s_hotplugHandler);
    }
}

void notifyUsbDevicesChanged() {
    std::function<void()> handler;
    {
        std::unique_lock lock(s_androidLock);
        if (!s_hotplugHandler) {
            s_pendingHotplug = true;
            return;
        }
        handler = s_hotplugHandler;
    }
    dispatchOnGuiThread(handler);
}

void setZ1AudioHandler(std::function<void()> handler) {
    std::unique_lock lock(s_androidLock);
    s_z1AudioHandler = std::move(handler);
    const bool pending = s_pendingZ1Audio;
    s_pendingZ1Audio = false;
    lock.unlock();
    if (pending && s_z1AudioHandler) {
        dispatchOnGuiThread(s_z1AudioHandler);
    }
}

void notifyZ1AudioReady() {
    std::function<void()> handler;
    {
        std::unique_lock lock(s_androidLock);
        if (!s_z1AudioHandler) {
            s_pendingZ1Audio = true;
            return;
        }
        handler = s_z1AudioHandler;
    }
    dispatchOnGuiThread(handler);
}

const QJniObject& getIntent() {
    __android_log_print(ANDROID_LOG_VERBOSE, "mixxx", "about to get intent");
    std::unique_lock lock(s_androidLock);
    if (s_intent.isValid()) {
        return s_intent;
    }
    // QNativeInterface::QAndroidApplication::runOnAndroidMainThread([]() {
    if (!QNativeInterface::QAndroidApplication::isActivityContext()) {
        __android_log_print(ANDROID_LOG_WARN,
                "mixxx",
                "current context doesn't refer to an activity!");
    }

    QJniObject context = QNativeInterface::QAndroidApplication::context();

    s_usbManager = QJniObject::callStaticObjectMethod(
            "org/mixxx/UsbPermission",
            "getInstance",
            "()Lorg/mixxx/UsbPermission;");
    // USB permission results are written into the PendingIntent extras.
    // FLAG_IMMUTABLE on API 31+ makes that fail silently, so the dialog never
    // completes. FLAG_MUTABLE exists only from API 31.
    const jint apiLevel = QJniObject::getStaticField<jint>(
            "android/os/Build$VERSION", "SDK_INT");
    jint pendingIntentFlags = 0;
    if (apiLevel >= 31) {
        pendingIntentFlags = QJniObject::getStaticField<jint>(
                "android/app/PendingIntent", "FLAG_MUTABLE");
    }
    QtJniTypes::String ACTION_USB_PERMISSION =
            QJniObject::fromString("org.mixxx.permissions.USB_PERMISSION");
    QJniObject intent("android/content/Intent",
            "(Ljava/lang/String;)V",
            ACTION_USB_PERMISSION.object<jstring>());
    const QJniObject packageName = context.callMethod<jstring>("getPackageName");
    intent.callObjectMethod("setPackage",
            "(Ljava/lang/String;)Landroid/content/Intent;",
            packageName.object<jstring>());
    if (!intent.isValid()) {
        __android_log_print(ANDROID_LOG_WARN, "mixxx", "pending intent is invalid!");
    }
    s_intent =
            QJniObject::callStaticMethod<jobject>("android/app/PendingIntent",
                    "getBroadcast",
                    "(Landroid/content/Context;ILandroid/content/"
                    "Intent;I)Landroid/app/PendingIntent;",
                    context,
                    0,
                    intent.object(),
                    pendingIntentFlags);

    if (!s_intent.isValid()) {
        __android_log_print(ANDROID_LOG_WARN, "mixxx", "pending intent is invalid!");
    }

    __android_log_print(ANDROID_LOG_VERBOSE,
            "mixxx",
            "about to register the the receiver %d",
            s_usbManager.isValid());
    auto success = s_usbManager.callMethod<jboolean>("registerServiceBroadcastReceiver",
            "(Landroid/content/Context;)Z",
            context.object<jobject>());
    if (!success) {
        __android_log_print(ANDROID_LOG_WARN, "mixxx", "failed to registered the receiver!");
    }
    // });
    return s_intent;
}

bool waitForPermission(const QJniObject& device) {
    __android_log_print(ANDROID_LOG_VERBOSE, "mixxx", "about to wait for perm");
    std::unique_lock lock(s_androidLock);
    std::vector<std::pair<QJniObject, bool>>::const_iterator result = s_grantingResult.cend();

    int retries = 0;

    while (!s_grantingWaitCond.wait_for(
            lock, std::chrono::seconds(1), [&result, device] {
                result = std::find_if(s_grantingResult.cbegin(),
                        s_grantingResult.cend(),
                        [device](auto resultPair) {
                            return resultPair.first == device;
                        });
                return result != s_grantingResult.cend();
            })) {
        __android_log_print(ANDROID_LOG_VERBOSE,
                "mixxx",
                "Not found - current result count: %lu",
                s_grantingResult.size());
        // Drop the lock before pumping events. The permission broadcast is
        // delivered on the GUI thread and needs s_androidLock to record the result.
        lock.unlock();
        QCoreApplication::processEvents();
        lock.lock();
        retries++;
        if (retries >= 10) {
            __android_log_print(ANDROID_LOG_WARN, "mixxx", "wait for perm timeout");
            qWarning() << "Timeout reached when waiting for Android permission to USB device";
            return false;
        }
    }
    __android_log_print(ANDROID_LOG_VERBOSE, "mixxx", "got perm result");
    return result->second;
}

void usbDeviceAccessResult(QJniObject device, bool granted) {
    std::unique_lock lock(s_androidLock);
    __android_log_print(ANDROID_LOG_WARN, "mixxx", "received permission result: %d", granted);
    s_grantingResult.push_back(std::make_pair<>(device, granted));
    s_grantingWaitCond.notify_one();
    // FIXME Handle large list?
}
} // namespace android
} // namespace mixxx

Q_DECLARE_JNI_CLASS(UsbPermissionClass, "org/mixxx/UsbPermission")

void usbDeviceAccessResult(JNIEnv*, jobject, jobject device, jboolean granted) {
    mixxx::android::usbDeviceAccessResult(device, granted);
}
Q_DECLARE_JNI_NATIVE_METHOD(usbDeviceAccessResult)

void usbDevicesChanged(JNIEnv*, jobject) {
    mixxx::android::notifyUsbDevicesChanged();
}
Q_DECLARE_JNI_NATIVE_METHOD(usbDevicesChanged)

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM*, void*) {
    QJniEnvironment env;
    env.registerNativeMethods<QtJniTypes::UsbPermissionClass>({
            Q_JNI_NATIVE_METHOD(usbDeviceAccessResult),
            Q_JNI_NATIVE_METHOD(usbDevicesChanged),
    });
    return JNI_VERSION_1_6;
}
