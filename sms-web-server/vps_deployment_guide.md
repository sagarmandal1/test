# Ubuntu VPS-এ SMS Gateway সার্ভার ডেপ্লয়মেন্ট গাইড

আপনার Express SMS Web Server-টিকে ২৪/৭ সচল এবং সুরক্ষিত রাখতে যেকোনো Ubuntu (20.04 / 22.04 / 24.04 LTS) VPS-এ ডেপ্লয় করার জন্য নিচের সহজ ধাপগুলো অনুসরণ করুন।

---

## 🛠️ Step 1: Ubuntu VPS-এ লগইন এবং আপডেট
প্রথমে আপনার কম্পিউটার থেকে SSH-এর মাধ্যমে VPS-এ কানেক্ট করুন:
```bash
ssh root@YOUR_VPS_IP
```
লগইন করার পর সার্ভারের প্যাকেজ লিস্ট আপডেট করুন:
```bash
sudo apt update && sudo apt upgrade -y
```

---

## 🟢 Step 2: Node.js এবং NPM ইন্সটল করা
আমরা NodeSource repository ব্যবহার করে লেটেস্ট LTS Node.js (v20) ইন্সটল করব:
```bash
# NodeSource setup script ডাউনলোড ও রান করুন
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Node.js ইন্সটল করুন
sudo apt-get install -y nodejs

# ইন্সটলেশন চেক করুন
node -v
npm -v
```

---

## 📂 Step 3: প্রজেক্ট ক্লোন এবং ডিপেনডেন্সি ইন্সটল
আপনার গিটহাব রিপোজিটরি থেকে সোর্স কোডটি ক্লোন করুন এবং ডিপেনডেন্সি ইন্সটল করুন:
```bash
# প্রজেক্ট ডিরেক্টরিতে যান
cd /var/www

# রিপোজিটরি ক্লোন করুন (আপনার গিটহাব লিঙ্ক ব্যবহার করুন)
git clone https://github.com/sagarmandal1/test.git sms-gateway

# প্রজেক্ট ফোল্ডারে যান
cd sms-gateway/sms-web-server

# npm প্যাকেজসমূহ ইন্সটল করুন
npm install
```

---

## 🔑 Step 4: Environment Variables (.env) কনফিগার করা
সার্ভারের জন্য `.env` ফাইল কনফিগার করতে হবে:
```bash
# .env ফাইল তৈরি করতে সার্ভারটি একবার রান করুন (এটি অটোমেটিক নতুন API Key তৈরি করবে)
node server.js
```
*(সার্ভারটি চালু হলে `Ctrl + C` চেপে বন্ধ করুন। এটি স্বয়ংক্রিয়ভাবে একটি `.env` ফাইল তৈরি করবে যেখানে আপনার API Key সেভ থাকবে।)*

আপনার তৈরি করা API Key দেখতে এবং সেটি পরিবর্তন/কপি করতে চাইলে:
```bash
cat .env
```
*(এখানে পাওয়া `API_KEY` মানটি কপি করে আপনার অ্যান্ড্রয়েড অ্যাপের Token ফিল্ডে সেভ করুন।)*

---

## 🔄 Step 5: PM2 দিয়ে ব্যাকগ্রাউন্ডে সার্ভার সচল রাখা (২৪/৭)
সার্ভার যাতে কোনো ক্র্যাশ বা রিবুট হলেও ব্যাকগ্রাউন্ডে সবসময় চালু থাকে, তার জন্য আমরা PM2 (Process Manager) ব্যবহার করব:

```bash
# গ্লোবালভাবে PM2 ইন্সটল করুন
sudo npm install pm2 -g

# PM2 দিয়ে আমাদের সার্ভারটি স্টার্ট করুন (ecosystem.config.js ব্যবহার করে)
pm2 start ecosystem.config.js

# সার্ভার রানিং স্ট্যাটাস চেক করুন
pm2 status

# VPS রিস্টার্ট হলেও যাতে সার্ভার নিজে নিজেই চালু হয়, তার জন্য স্টার্টআপ স্ক্রিপ্ট সেট করুন
pm2 startup systemd
```
*(উপরের কমান্ডটি রান করার পর টার্মিনালে একটি বড় কমান্ড দেখতে পাবেন, যা রান করতে বলা হবে। সেই কমান্ডটি কপি করে হুবহু টার্মিনালে পেস্ট করে এন্টার দিন।)*

সবশেষে PM2 এর বর্তমান অবস্থা সেভ করে রাখুন:
```bash
pm2 save
```

---

## 🛡️ Step 6: Nginx Reverse Proxy সেটআপ করা
Nginx ব্যবহার করে আমরা পোর্ট `3000` কে পোর্ট `80` (HTTP) এবং `443` (HTTPS) এ রি-ডাইরেক্ট করব:

```bash
# Nginx ইন্সটল করুন
sudo apt install nginx -y

# নতুন Nginx কনফিগারেশন ফাইল তৈরি করুন
sudo nano /etc/nginx/sites-available/sms-gateway
```

ফাইলের ভেতর নিচের কনফিগারেশনটি পেস্ট করুন (আপনার ডোমেইন থাকলে `YOUR_DOMAIN` এর জায়গায় লিখুন, অথবা ডোমেইন না থাকলে ডোমেইন লাইনের পরিবর্তে আইপি ব্যবহার করুন):

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_VPS_IP;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
*(সেভ করে বের হওয়ার জন্য: `Ctrl + O` -> `Enter` -> `Ctrl + X`)*

কনফিগারেশনটি একটিভেট করুন এবং Nginx রিস্টার্ট করুন:
```bash
# ডিফল্ট সাইট রিমুভ করুন (যদি থাকে)
sudo rm /etc/nginx/sites-enabled/default

# নতুন সাইটটি লিংক করুন
sudo ln -s /etc/nginx/sites-available/sms-gateway /etc/nginx/sites-enabled/

# Nginx টেস্ট করুন
sudo nginx -t

# Nginx রিস্টার্ট করুন
sudo systemctl restart nginx
```

---

## 🔒 Step 7: Let's Encrypt দিয়ে SSL (HTTPS) কনফিগার করা
আপনার অ্যান্ড্রোয়েড ডিভাইস এবং পেমেন্ট রিকোয়েস্ট সম্পূর্ণ নিরাপদ রাখতে SSL (HTTPS) অত্যন্ত জরুরি। আপনার একটি ডোমেইন থাকলে নিচের কমান্ডগুলো দিয়ে ফ্রিতে SSL সেটআপ করতে পারবেন:

```bash
# Certbot এবং Nginx প্লাগিন ইন্সটল করুন
sudo apt install certbot python3-certbot-nginx -y

# আপনার ডোমেইনের জন্য SSL সার্টিফিকেট জেনারেট করুন
sudo certbot --nginx -d YOUR_DOMAIN
```
*(কমান্ডটি রান করার পর কিছু ইমেইল এড্রেস চাবে এবং লাইসেন্স এগ্রিমেন্ট এক্সেপ্ট করতে বলবে। সবশেষে redirect অপশন সিলেক্ট করলে Nginx অটোমেটিক HTTPS-এ ট্রাফিক রি-ডাইরেক্ট করে নেবে।)*

---

## 📈 দরকারী PM2 কমান্ডসমূহ
ডিপ্লয় করার পর যেকোনো সময় সার্ভার মনিটর বা কন্ট্রোল করতে এই কমান্ডগুলো ব্যবহার করবেন:
* **সার্ভার লগ দেখতে**: `pm2 logs`
* **সার্ভার রিস্টার্ট করতে**: `pm2 restart sms-gateway-server`
* **সার্ভার স্টপ করতে**: `pm2 stop sms-gateway-server`
* **সার্ভার মনিটর (CPU/Memory usage)**: `pm2 monit`
