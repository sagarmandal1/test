package com.smssync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.util.Log

class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            Log.d(TAG, "SMS Received Action captured.")
            
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            if (messages.isEmpty()) return

            // Combine multipart messages from the same sender
            val sender = messages[0].displayOriginatingAddress ?: "Unknown"
            val body = StringBuilder()
            for (msg in messages) {
                body.append(msg.displayMessageBody)
            }
            val messageText = body.toString()
            val timestamp = messages[0].timestampMillis

            // Extract SIM slot index if available in intent extras (dual-SIM support)
            var simSlot = 1
            if (intent.hasExtra("subscription")) {
                val subId = intent.getIntExtra("subscription", -1)
                Log.d(TAG, "SMS subscription ID: $subId")
            }
            if (intent.hasExtra("simSlot")) {
                simSlot = intent.getIntExtra("simSlot", 0) + 1
            } else if (intent.hasExtra("slot")) {
                simSlot = intent.getIntExtra("slot", 0) + 1
            }

            Log.d(TAG, "Parsed SMS from $sender: $messageText (SIM Slot: $simSlot)")

            // Forward the SMS to the SyncService to handle safe background network requests
            val serviceIntent = Intent(context, SyncService::class.java).apply {
                action = SyncService.ACTION_SYNC_SMS
                putExtra(SyncService.EXTRA_SENDER, sender)
                putExtra(SyncService.EXTRA_MESSAGE, messageText)
                putExtra(SyncService.EXTRA_TIMESTAMP, timestamp)
                putExtra(SyncService.EXTRA_SIM_SLOT, simSlot)
            }
            
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            } catch (e: Exception) {
                Log.error(TAG, "Failed to start SyncService from SmsReceiver", e)
            }
        }
    }

    // Workaround Logger for Kotlin
    object Log {
        fun d(tag: String, msg: String) {
            android.util.Log.d(tag, msg)
        }
        fun error(tag: String, msg: String, tr: Throwable) {
            android.util.Log.e(tag, msg, tr)
        }
    }

    companion object {
        private const val TAG = "SmsReceiver"
    }
}
