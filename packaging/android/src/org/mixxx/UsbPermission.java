package org.mixxx;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Log;

public class UsbPermission {
    private static final String ACTION_USB_PERMISSION =
        "org.mixxx.permissions.USB_PERMISSION";
    private static final String TAG = "MixxxUsbPermission";
    private static UsbPermission instance;
    private boolean receiversRegistered = false;

    public static synchronized UsbPermission getInstance() {
        if (instance == null) {
            instance = new UsbPermission();
        }
        return instance;
    }

    private static native void usbDeviceAccessResult(Object device, boolean granted);

    public static native void usbDevicesChanged();

    public boolean registerServiceBroadcastReceiver(Context context) {
        if (receiversRegistered) {
            return true;
        }
        try {
            IntentFilter permissionFilter = new IntentFilter(ACTION_USB_PERMISSION);
            context.registerReceiver(
                usbPermissionReceiver,
                permissionFilter,
                Context.RECEIVER_NOT_EXPORTED);
            IntentFilter detachFilter =
                new IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED);
            context.registerReceiver(
                usbDetachReceiver, detachFilter, Context.RECEIVER_NOT_EXPORTED);
            receiversRegistered = true;
            Log.i(TAG, "Registered USB permission and detach receivers");
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Unable to register the broadcast receiver: " + e.toString());
            return false;
        }
    }

    private static UsbDevice usbDeviceFromIntent(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
        }
        return intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
    }

    private final BroadcastReceiver usbPermissionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            Log.v(TAG, "Received " + action);
            if (ACTION_USB_PERMISSION.equals(action)) {
                synchronized (this) {
                    UsbDevice usbDevice = usbDeviceFromIntent(intent);
                    if (usbDevice == null) {
                        Log.e(TAG, "USB device is null");
                        return;
                    }
                    boolean granted =
                        intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                    usbDeviceAccessResult(usbDevice, granted);
                    if (!granted) {
                        Log.w(TAG, "Permission was denied");
                    } else {
                        Log.i(TAG, "Permission was granted");
                    }
                }
            }
        }
    };

    private final BroadcastReceiver usbDetachReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction())) {
                Log.i(TAG, "USB device detached");
                usbDevicesChanged();
            }
        }
    };
}
