# PawaPay Callback URL Configuration

## 📋 Callback URL for PawaPay Dashboard

Use this URL when configuring your callback in the PawaPay Dashboard:

```
https://ethanbackend.vercel.app/api/payments/callback
```

**Note:** If your backend is deployed to a different Vercel URL, replace `ethanbackend.vercel.app` with your actual backend domain.

### ✅ Verify the Callback URL is Working

After deployment, you can verify the callback URL is accessible by visiting it in your browser:
- **GET request**: `https://ethanbackend.vercel.app/api/payments/callback`
- Should return: `{ "success": true, "message": "PawaPay callback endpoint is active", ... }`

**Important:** The endpoint accepts both GET (for verification) and POST (for actual webhooks from PawaPay).

---

## 🔧 How to Configure in PawaPay Dashboard

1. **Log in to PawaPay Dashboard**
   - Go to https://dashboard.pawapay.io (or your PawaPay dashboard URL)
   - Sign in with your merchant account

2. **Navigate to System Configuration**
   - Go to **System Configuration** → **Callback URLs**

3. **Add Callback URL**
   - Enter the callback URL: `https://ethanbackend.vercel.app/api/payments/callback`
   - Click **Save** or **Add**

4. **Generate API Token** (if not already done)
   - Go to **System Configuration** → **API Tokens**
   - Click **Create API Token** or **Generate API Token**
   - Copy the token and use it in your `.env` file as `PAWAPAY_API_TOKEN`

---

## ✅ What the Callback Does

The callback endpoint (`/api/payments/callback`) receives webhook notifications from PawaPay when:
- Payment status changes (e.g., from `PROCESSING` to `COMPLETED`)
- Payment fails
- Payment is approved by the user

The endpoint:
- ✅ Updates payment status in your database
- ✅ Logs all webhook events for debugging
- ✅ Returns success response to PawaPay (prevents retries)

---

## 🔍 Testing the Callback

After configuring the callback URL in PawaPay:

1. Make a test payment
2. Check Vercel logs for callback webhook logs:
   ```
   [PawaPay Callback] Received webhook: ...
   [PawaPay Callback] ✅ Payment updated: ...
   ```

3. Verify payment status is updated in your database

---

## ⚠️ Important Notes

- **Public URL Required**: The callback URL must be publicly accessible (not localhost)
- **HTTPS Required**: PawaPay only sends webhooks to HTTPS URLs
- **Always Return 200**: The callback should return HTTP 200 even on errors to prevent infinite retries
- **Webhook Format**: PawaPay sends data in format: `{ data: { depositId, status, ... } }`

---

## 🐛 Troubleshooting

**Callback not receiving webhooks:**
- Verify the URL is correct and publicly accessible
- Check Vercel function logs for errors
- Ensure HTTPS is enabled (not HTTP)
- Verify the endpoint returns HTTP 200 status

**Payment status not updating:**
- Check Vercel logs for callback webhook logs
- Verify `depositId` matches between payment creation and callback
- Check database connection is working

---

## 📝 Environment Variables

Make sure these are set in your Vercel project:

```env
PAWAPAY_API_TOKEN=your_api_token_here
PAWAPAY_API_URL=https://api.pawapay.io/v2
```

Set these in: **Vercel Dashboard** → **Your Project** → **Settings** → **Environment Variables**

