package com.smssync

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.database.Cursor
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.provider.Telephony
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.gson.Gson
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private val client = OkHttpClient()
    private val gson = Gson()

    // View References
    private lateinit var etServerUrl: EditText
    private lateinit var etApiToken: EditText
    private lateinit var etDeviceName: EditText
    private lateinit var layoutRadarButton: View
    private lateinit var tvServiceStatus: TextView
    private lateinit var btnSaveConfig: Button
    private lateinit var btnTestConnection: Button
    private lateinit var btnSyncHistory: Button
    private lateinit var tvLogs: TextView
    
    // Background protection view links
    private lateinit var tvBatteryStatus: TextView
    private lateinit var tvBootStatus: TextView
    private lateinit var btnWhitelistBattery: Button

    // Tab Layout References
    private lateinit var layoutDashboard: View
    private lateinit var layoutSettings: View
    private lateinit var tabDashboard: View
    private lateinit var tabSettings: View
    private lateinit var ivTabDashboard: ImageView
    private lateinit var tvTabDashboard: TextView
    private lateinit var ivTabSettings: ImageView
    private lateinit var tvTabSettings: TextView

    // Dashboard UI References
    private lateinit var ivRadarCore: ImageView
    private lateinit var tvRadarStatus: TextView
    private lateinit var tvRadarSubtitle: TextView
    private lateinit var tvStatsTodayCount: TextView
    private lateinit var tvStatsSimSlots: TextView
    private lateinit var tvStatsLatency: TextView

    private val logsList = mutableListOf<String>()
    private var hasPromptedBattery = false

    // Broadcast receiver to listen for background service logs
    private val logReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent?.getStringExtra(SyncService.EXTRA_LOG_MSG)?.let { logMsg ->
                addLog(logMsg)
            }
            intent?.let {
                if (it.hasExtra("today_count")) {
                    val count = it.getIntExtra("today_count", 0)
                    tvStatsTodayCount.text = count.toString()
                }
                if (it.hasExtra("latency")) {
                    val latency = it.getLongExtra("latency", 0L)
                    tvStatsLatency.text = "${latency} ms"
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize Views
        etServerUrl = findViewById(R.id.etServerUrl)
        etApiToken = findViewById(R.id.etApiToken)
        etDeviceName = findViewById(R.id.etDeviceName)
        layoutRadarButton = findViewById(R.id.layoutRadarButton)
        tvServiceStatus = findViewById(R.id.tvServiceStatus)
        btnSaveConfig = findViewById(R.id.btnSaveConfig)
        btnTestConnection = findViewById(R.id.btnTestConnection)
        btnSyncHistory = findViewById(R.id.btnSyncHistory)
        tvLogs = findViewById(R.id.tvLogs)
        
        // Background Protection Views
        tvBatteryStatus = findViewById(R.id.tvBatteryStatus)
        tvBootStatus = findViewById(R.id.tvBootStatus)
        btnWhitelistBattery = findViewById(R.id.btnWhitelistBattery)

        // Tab Containers & Toggles
        layoutDashboard = findViewById(R.id.layout_dashboard)
        layoutSettings = findViewById(R.id.layout_settings)
        tabDashboard = findViewById(R.id.tabDashboard)
        tabSettings = findViewById(R.id.tabSettings)
        ivTabDashboard = findViewById(R.id.ivTabDashboard)
        tvTabDashboard = findViewById(R.id.tvTabDashboard)
        ivTabSettings = findViewById(R.id.ivTabSettings)
        tvTabSettings = findViewById(R.id.tvTabSettings)

        // Dashboard Stats & Radar
        ivRadarCore = findViewById(R.id.ivRadarCore)
        tvRadarStatus = findViewById(R.id.tvRadarStatus)
        tvRadarSubtitle = findViewById(R.id.tvRadarSubtitle)
        tvStatsTodayCount = findViewById(R.id.tvStatsTodayCount)
        tvStatsSimSlots = findViewById(R.id.tvStatsSimSlots)
        tvStatsLatency = findViewById(R.id.tvStatsLatency)

        // Load Saved Configuration
        loadSavedConfig()

        // Setup Listeners
        btnSaveConfig.setOnClickListener { saveConfig() }
        btnTestConnection.setOnClickListener { testConnection() }
        btnSyncHistory.setOnClickListener { syncSmsHistory() }
        btnWhitelistBattery.setOnClickListener { requestBatteryOptimizationBypass() }

        layoutRadarButton.setOnClickListener {
            if (SyncService.isRunning) {
                stopSyncService()
            } else {
                if (checkAndRequestPermissions()) {
                    startSyncService()
                }
            }
        }

        // Setup Tab Listeners
        tabDashboard.setOnClickListener { switchToTab(true) }
        tabSettings.setOnClickListener { switchToTab(false) }

        // Default tab behavior
        val serverUrl = etServerUrl.text.toString().trim()
        if (serverUrl.isEmpty()) {
            switchToTab(false)
        } else {
            switchToTab(true)
        }

        // Register Log Receiver
        val filter = IntentFilter(SyncService.ACTION_LOG_BROADCAST)
        registerReceiver(logReceiver, filter, RECEIVER_EXPORTED_FLAG())

        addLog("System initialized. Awaiting configuration.")
    }

    override fun onResume() {
        super.onResume()
        updateServiceStatusUI()
        checkBatteryOptimization()
        loadStats()
        updateSimSlots()
        
        if (!hasPromptedBattery) {
            hasPromptedBattery = true
            showBatteryExemptionDialog()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(logReceiver)
    }

    private fun RECEIVER_EXPORTED_FLAG(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            RECEIVER_EXPORTED
        } else {
            0
        }
    }

    // Load SharedPreferences Config
    private fun loadSavedConfig() {
        val prefs = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        val savedUrl = prefs.getString(SyncService.KEY_SERVER_URL, "") ?: ""
        val savedToken = prefs.getString(SyncService.KEY_API_TOKEN, "") ?: ""
        val savedName = prefs.getString(SyncService.KEY_DEVICE_NAME, "") ?: ""
        etServerUrl.setText(savedUrl)
        etApiToken.setText(savedToken)
        etDeviceName.setText(if (savedName.isEmpty()) Build.MODEL else savedName)
        
        updateServiceStatusUI()
    }

    // Save SharedPreferences Config
    private fun saveConfig() {
        val url = etServerUrl.text.toString().trim()
        val token = etApiToken.text.toString().trim()
        val name = etDeviceName.text.toString().trim()

        if (url.isEmpty()) {
            Toast.makeText(this, "Please enter a valid Server URL", Toast.LENGTH_SHORT).show()
            return
        }

        val prefs = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().apply {
            putString(SyncService.KEY_SERVER_URL, url)
            putString(SyncService.KEY_API_TOKEN, token)
            putString(SyncService.KEY_DEVICE_NAME, name.ifEmpty { Build.MODEL })
            apply()
        }

        addLog("Configuration saved: $url ($name)")
        Toast.makeText(this, "Configuration Saved!", Toast.LENGTH_SHORT).show()
    }

    // Test URL Connectivity Ping
    private fun testConnection() {
        val serverUrl = etServerUrl.text.toString().trim()
        val token = etApiToken.text.toString().trim()
        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "Enter Server URL first", Toast.LENGTH_SHORT).show()
            return
        }

        addLog("[Testing] Ping to $serverUrl...")
        
        val testUrl = if (serverUrl.endsWith("/")) "${serverUrl}api/devices" else "$serverUrl/api/devices"
        val request = Request.Builder()
            .url(testUrl)
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    addLog("[Ping Failed] Server unreachable: ${e.localizedMessage}")
                    Toast.makeText(this@MainActivity, "Connection Failed", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                runOnUiThread {
                    if (response.isSuccessful) {
                        addLog("[Ping Success] Gateway online! Server code: ${response.code}")
                        Toast.makeText(this@MainActivity, "Ping Successful!", Toast.LENGTH_SHORT).show()
                    } else {
                        addLog("[Ping Error] Server returned code: ${response.code}")
                        Toast.makeText(this@MainActivity, "Server Error: ${response.code}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    // Sync Old/Existing SMS Inbox Messages
    private fun syncSmsHistory() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.READ_SMS), PERMISSIONS_REQUEST_CODE)
            return
        }

        val serverUrl = etServerUrl.text.toString().trim()
        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "Configure Server URL first!", Toast.LENGTH_SHORT).show()
            return
        }

        addLog("[Syncing] Fetching local SMS inbox history...")
        val smsList = mutableListOf<Map<String, Any>>()
        val uri = Uri.parse("content://sms/inbox")
        val projection = arrayOf("_id", "address", "body", "date")
        
        val cursor: Cursor? = contentResolver.query(uri, projection, null, null, "date DESC LIMIT 50")
        
        cursor?.use { c ->
            val addressIdx = c.getColumnIndex("address")
            val bodyIdx = c.getColumnIndex("body")
            val dateIdx = c.getColumnIndex("date")

            while (c.moveToNext()) {
                val address = c.getString(addressIdx) ?: "Unknown"
                val body = c.getString(bodyIdx) ?: ""
                val date = c.getLong(dateIdx)

                smsList.add(mapOf(
                    "sender" to address,
                    "message" to body,
                    "timestamp" to date,
                    "sim_slot" to 1,
                    "battery" to 100
                ))
            }
        }

        if (smsList.isEmpty()) {
            addLog("[Sync Complete] No messages found in device inbox.")
            return
        }

        addLog("[Syncing] Found ${smsList.size} items. Uploading...")
        
        val prefs = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        val deviceName = prefs.getString(SyncService.KEY_DEVICE_NAME, Build.MODEL) ?: Build.MODEL
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown_device"
        val token = prefs.getString(SyncService.KEY_API_TOKEN, "") ?: ""

        val payload = mapOf(
            "device_id" to deviceId,
            "device_name" to deviceName,
            "messages" to smsList
        )

        val jsonString = gson.toJson(payload)
        val mediaType = "application/json; charset=utf-8".toMediaType()
        val requestBody = jsonString.toRequestBody(mediaType)
        val syncUrl = if (serverUrl.endsWith("/")) "${serverUrl}api/sms/sync" else "$serverUrl/api/sms/sync"

        val request = Request.Builder()
            .url(syncUrl)
            .header("Authorization", "Bearer $token")
            .post(requestBody)
            .build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    addLog("[Sync Failed] Error uploading batch: ${e.localizedMessage}")
                }
            }

            override fun onResponse(call: Call, response: Response) {
                runOnUiThread {
                    if (response.isSuccessful) {
                        addLog("[Sync Success] Bulk upload complete for ${smsList.size} messages!")
                        Toast.makeText(this@MainActivity, "Bulk Sync Complete!", Toast.LENGTH_SHORT).show()
                    } else {
                        addLog("[Sync Error] Server rejected transaction: ${response.code}")
                    }
                }
            }
        })
    }

    // Service Management
    private fun startSyncService() {
        val prefs = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(SyncService.KEY_SERVICE_ENABLED, true).apply()

        val serviceIntent = Intent(this, SyncService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            tvServiceStatus.text = "Service Status: Running"
            tvServiceStatus.setTextColor(ContextCompat.getColor(this, R.color.active_green))
            addLog("Foreground Sync Service started.")
        } catch (e: Exception) {
            addLog("Failed to start service: ${e.message}")
        }
    }

    private fun stopSyncService() {
        val prefs = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(SyncService.KEY_SERVICE_ENABLED, false).apply()

        val serviceIntent = Intent(this, SyncService::class.java)
        stopService(serviceIntent)
        tvServiceStatus.text = "Service Status: Inactive"
        tvServiceStatus.setTextColor(ContextCompat.getColor(this, R.color.text_muted))
        addLog("Foreground Sync Service stopped.")
    }

    private fun updateServiceStatusUI() {
        if (SyncService.isRunning) {
            tvServiceStatus.text = "Service Status: Running"
            tvServiceStatus.setTextColor(ContextCompat.getColor(this, R.color.active_green))

            // Radar Active State
            ivRadarCore.setColorFilter(Color.parseColor("#22C55E"))
            tvRadarStatus.text = "GATEWAY ONLINE"
            tvRadarStatus.setTextColor(Color.parseColor("#22C55E"))
            tvRadarSubtitle.text = "24/7 background sync is active. Tap to stop."
        } else {
            tvServiceStatus.text = "Service Status: Inactive"
            tvServiceStatus.setTextColor(ContextCompat.getColor(this, R.color.text_muted))

            // Radar Inactive State
            ivRadarCore.setColorFilter(Color.parseColor("#EF4444"))
            tvRadarStatus.text = "GATEWAY INACTIVE"
            tvRadarStatus.setTextColor(Color.parseColor("#EF4444"))
            tvRadarSubtitle.text = "Tap to activate 24/7 background sync"
        }
    }

    private fun checkBatteryOptimization() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val isIgnoring = pm.isIgnoringBatteryOptimizations(packageName)
            if (isIgnoring) {
                tvBatteryStatus.text = "Battery Saver: Protected"
                tvBatteryStatus.setTextColor(ContextCompat.getColor(this, R.color.active_green))
                btnWhitelistBattery.text = "Protected"
                btnWhitelistBattery.isEnabled = false
                btnWhitelistBattery.alpha = 0.5f
            } else {
                tvBatteryStatus.text = "Battery Saver: Optimized (Restricted)"
                tvBatteryStatus.setTextColor(ContextCompat.getColor(this, R.color.text_muted))
                btnWhitelistBattery.text = "Bypass"
                btnWhitelistBattery.isEnabled = true
                btnWhitelistBattery.alpha = 1.0f
            }
        } else {
            tvBatteryStatus.text = "Battery Saver: Unlimited Support"
            btnWhitelistBattery.text = "Supported"
            btnWhitelistBattery.isEnabled = false
            btnWhitelistBattery.alpha = 0.5f
        }
    }

    private fun requestBatteryOptimizationBypass() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            } catch (e: Exception) {
                try {
                    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    startActivity(intent)
                } catch (ex: Exception) {
                    Toast.makeText(this, "Could not open battery settings. Please whitelist manually.", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    // Permission Systems
    private fun checkAndRequestPermissions(): Boolean {
        val receiveSms = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS)
        val readSms = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
        val permissions = mutableListOf<String>()

        if (receiveSms != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.RECEIVE_SMS)
        }
        if (readSms != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.READ_SMS)
        }

        // Post Notifications permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val postNotification = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            if (postNotification != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), PERMISSIONS_REQUEST_CODE)
            return false
        }
        return true
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSIONS_REQUEST_CODE) {
            var allGranted = true
            for (result in grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false
                    break
                }
            }

            if (allGranted) {
                addLog("All permissions successfully granted.")
                startSyncService()
            } else {
                addLog("[Warn] Missing required permissions. Sync disabled.")
                Toast.makeText(this, "Permissions required for Gateway operation", Toast.LENGTH_LONG).show()
                stopSyncService()
            }
        }
    }

    // Dynamic UI Logger Helper
    private fun addLog(message: String) {
        val timeStamp = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        logsList.add(0, "[$timeStamp] $message") // prepend

        // keep last 50 entries
        if (logsList.size > 50) {
            logsList.removeAt(logsList.size - 1)
        }

        val sb = StringBuilder()
        for (log in logsList) {
            sb.append(log).append("\n")
        }
        tvLogs.text = sb.toString()
    }

    private fun showBatteryExemptionDialog() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                if (isFinishing || isDestroyed) return
                
                androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("Background Reliability")
                    .setMessage("Modern Android devices restrict background sync to save battery. To ensure 24/7 real-time SMS payment sync, please whitelist the gateway app.\n\nChoose 'Allow' in the next system screen.")
                    .setCancelable(false)
                    .setPositiveButton("Configure") { dialog, _ ->
                        dialog.dismiss()
                        requestBatteryOptimizationBypass()
                    }
                    .setNegativeButton("Later") { dialog, _ ->
                        dialog.dismiss()
                        addLog("Warning: Battery optimizations active. Sync may be delayed.")
                    }
                    .show()
            }
        }
    }

    private fun switchToTab(showDashboard: Boolean) {
        if (showDashboard) {
            layoutDashboard.visibility = View.VISIBLE
            layoutSettings.visibility = View.GONE

            ivTabDashboard.setColorFilter(Color.parseColor("#6366F1"))
            tvTabDashboard.setTextColor(Color.parseColor("#6366F1"))
            tvTabDashboard.setTypeface(null, Typeface.BOLD)

            ivTabSettings.setColorFilter(Color.parseColor("#94A3B8"))
            tvTabSettings.setTextColor(Color.parseColor("#94A3B8"))
            tvTabSettings.setTypeface(null, Typeface.NORMAL)
        } else {
            layoutDashboard.visibility = View.GONE
            layoutSettings.visibility = View.VISIBLE

            ivTabDashboard.setColorFilter(Color.parseColor("#94A3B8"))
            tvTabDashboard.setTextColor(Color.parseColor("#94A3B8"))
            tvTabDashboard.setTypeface(null, Typeface.NORMAL)

            ivTabSettings.setColorFilter(Color.parseColor("#6366F1"))
            tvTabSettings.setTextColor(Color.parseColor("#6366F1"))
            tvTabSettings.setTypeface(null, Typeface.BOLD)
        }
    }

    private fun loadStats() {
        val prefs = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        val sdf = SimpleDateFormat("yyyyMMdd", Locale.US)
        val todayStr = sdf.format(Date())
        val savedDate = prefs.getString("sync_date", "")
        val count = if (savedDate == todayStr) {
            prefs.getInt("today_synced_count", 0)
        } else {
            0
        }
        tvStatsTodayCount.text = count.toString()
    }

    private fun updateSimSlots() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
            try {
                val subscriptionManager = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? android.telephony.SubscriptionManager
                if (subscriptionManager != null) {
                    val activeList = subscriptionManager.activeSubscriptionInfoList
                    val count = activeList?.size ?: 0
                    if (count > 0) {
                        tvStatsSimSlots.text = if (count == 1) "SIM 1 Active" else "Dual SIM ($count)"
                        return
                    }
                }
            } catch (e: Exception) {
                // safely ignore
            }
        }
        tvStatsSimSlots.text = "Active Sim"
    }

    companion object {
        private const val PERMISSIONS_REQUEST_CODE = 444
    }
}
