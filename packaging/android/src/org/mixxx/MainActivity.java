package org.mixxx;

import android.content.Intent;
import android.hardware.usb.UsbManager;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import org.qtproject.qt.android.QtActivityBase;

public class MainActivity extends QtActivityBase {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        UsbPermission.getInstance().registerServiceBroadcastReceiver(this);

        // Disable drawing over cutout - isn't working
        WindowManager.LayoutParams lp = this.getWindow().getAttributes();
        lp.layoutInDisplayCutoutMode =
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;

        // Disable system and navigation bar to prevent accidental back or app switch
        WindowInsetsControllerCompat windowInsetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        windowInsetsController.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        windowInsetsController.hide(WindowInsetsCompat.Type.navigationBars());

        notifyIfUsbAttach(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        notifyIfUsbAttach(intent);
    }

    private void notifyIfUsbAttach(Intent intent) {
        if (intent != null && UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(intent.getAction())) {
            UsbPermission.usbDevicesChanged();
        }
    }
}
