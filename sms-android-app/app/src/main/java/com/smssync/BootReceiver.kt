package com.smssync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.d(TAG, "Received Broadcast action: $action")
        
        if (action == Intent.ACTION_BOOT_COMPLETED || 
            action == "android.intent.action.QUICKBOOT_POWERON" || 
            action == "com.htc.intent.action.QUICKBOOT_POWERON") {
            
            val prefs = context.getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
            val serviceEnabled = prefs.getBoolean(SyncService.KEY_SERVICE_ENABLED, false)
            Log.d(TAG, "Boot check: serviceEnabled = $serviceEnabled")

            if (serviceEnabled) {
                Log.d(TAG, "Auto-starting SyncService on device startup...")
                val serviceIntent = Intent(context, SyncService::class.java)
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to start SyncService from BootReceiver", e)
                }
            }
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
