package com.smssync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.gson.Gson
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException

class SyncService : Service() {

    private val client = OkHttpClient()
    private val gson = Gson()

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "SyncService Created.")
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent != null && intent.action == ACTION_SYNC_SMS) {
            val sender = intent.getStringExtra(EXTRA_SENDER) ?: "Unknown"
            val message = intent.getStringExtra(EXTRA_MESSAGE) ?: ""
            val timestamp = intent.getLongExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
            val simSlot = intent.getIntExtra(EXTRA_SIM_SLOT, 1)

            Log.d(TAG, "Syncing SMS from $sender...")
            syncSmsToServer(sender, message, timestamp, simSlot)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    // Network Operation: Post SMS JSON payload to server
    private fun syncSmsToServer(sender: String, message: String, timestamp: Long, simSlot: Int) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val serverUrl = prefs.getString(KEY_SERVER_URL, "") ?: ""
        val apiToken = prefs.getString(KEY_API_TOKEN, "") ?: ""
        val deviceName = prefs.getString(KEY_DEVICE_NAME, "Android Device") ?: "Android Device"
        val deviceId = getDeviceId()

        if (serverUrl.isEmpty()) {
            val logMsg = "Sync Failed: Server URL not configured."
            Log.w(TAG, logMsg)
            broadcastLog(logMsg)
            return
        }

        val batteryLevel = getBatteryPercentage()
        
        // Prepare Payload
        val payload = mapOf(
            "device_id" to deviceId,
            "device_name" to deviceName,
            "sender" to sender,
            "message" to message,
            "timestamp" to timestamp,
            "sim_slot" to simSlot,
            "battery" to batteryLevel
        )

        val jsonString = gson.toJson(payload)
        val mediaType = "application/json; charset=utf-8".toMediaType()
        val requestBody = jsonString.toRequestBody(mediaType)

        val fullUrl = if (serverUrl.endsWith("/")) "${serverUrl}api/sms" else "$serverUrl/api/sms"

        val request = Request.Builder()
            .url(fullUrl)
            .header("Authorization", "Bearer $apiToken")
            .post(requestBody)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                val logMsg = "Failed to sync: ${e.message}"
                Log.e(TAG, logMsg)
                broadcastLog("[Error] SMS from $sender sync failed: ${e.localizedMessage}")
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (response.isSuccessful) {
                        val logMsg = "Successfully synced SMS from $sender to server."
                        Log.d(TAG, logMsg)
                        broadcastLog("[Success] Synced SMS from $sender")
                    } else {
                        val logMsg = "Server returned error: ${response.code} ${response.message}"
                        Log.e(TAG, logMsg)
                        broadcastLog("[Error] Server returned code ${response.code} for $sender")
                    }
                }
            }
        })
    }

    // Helper: Retrieve Battery Level
    private fun getBatteryPercentage(): Int {
        val batteryStatus: Intent? = IntentFilter(Intent.ACTION_BATTERY_CHANGED).let { ifFilter ->
            registerReceiver(null, ifFilter)
        }
        val level: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        return if (level >= 0 && scale > 0) {
            ((level.toFloat() / scale.toFloat()) * 100).toInt()
        } else {
            100
        }
    }

    // Unique Persistent Device ID
    private fun getDeviceId(): String {
        return Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown_device"
    }

    // Broadcast log back to MainActivity if it is running
    private fun broadcastLog(message: String) {
        val logIntent = Intent(ACTION_LOG_BROADCAST).apply {
            putExtra(EXTRA_LOG_MSG, message)
        }
        sendBroadcast(logIntent)
    }

    // Create Notification Channel for Android O+
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SMS Sync Foreground Service Channel",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keep background SMS gateway sync active"
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    // Create persistent Foreground Notification
    private fun createNotification(): Notification {
        val stopServiceIntent = Intent(this, SyncService::class.java).apply {
            action = ACTION_STOP_SERVICE
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SMS Gateway Active")
            .setContentText("Listening and syncing SMS to web server in real-time")
            .setSmallIcon(android.R.drawable.sym_def_app_icon)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "SmsSyncChannel"
        const val NOTIFICATION_ID = 101
        private const val TAG = "SyncService"

        // SharedPreferences Constants
        const val PREFS_NAME = "SmsSyncPrefs"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_API_TOKEN = "api_token"
        const val KEY_DEVICE_NAME = "device_name"

        // Actions
        const val ACTION_SYNC_SMS = "com.smssync.action.SYNC_SMS"
        const val ACTION_STOP_SERVICE = "com.smssync.action.STOP_SERVICE"
        const val ACTION_LOG_BROADCAST = "com.smssync.action.LOG_BROADCAST"

        // Extras
        const val EXTRA_SENDER = "sender"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_TIMESTAMP = "timestamp"
        const val EXTRA_SIM_SLOT = "sim_slot"
        const val EXTRA_LOG_MSG = "log_msg"
    }
}
