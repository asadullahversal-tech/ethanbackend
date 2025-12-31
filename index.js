const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const { randomUUID } = require('crypto')

dotenv.config()

const app = express()
const port = process.env.PORT || 8080
const jwtSecret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET || 'change-me'
const dbUrl = "mongodb+srv://andukamarlony_db_user:4QMlMiSbaVgGOI0v@cluster0.m4tjofp.mongodb.net/"

// CORS - Allow all origins explicitly (NO RESTRICTIONS)
app.use((req, res, next) => {
  // Set all CORS headers to allow everything
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD')
  res.header('Access-Control-Allow-Headers', '*') // Allow all headers
  res.header('Access-Control-Expose-Headers', '*') // Expose all headers
  res.header('Access-Control-Max-Age', '86400') // Cache preflight for 24 hours
  res.header('Access-Control-Allow-Credentials', 'true')
  
  // Handle preflight requests immediately
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  next()
})

app.use(express.json())

// --- DB connection ---
let dbConnected = false

async function connectDb() {
  if (!dbUrl) {
    console.warn('[db] DATABASE_URL is missing; API will fail without a DB.')
    return false
  }
  
  // Reuse existing connection if available
  if (mongoose.connection.readyState === 1) {
    return true
  }
  
  try {
    // Add connection options for better error handling
    await mongoose.connect(dbUrl, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      retryWrites: true,
    })
    dbConnected = true
    console.log('[db] connected successfully')
    return true
  } catch (err) {
    console.error('[db] connection error:', err.message)
    
    // Provide helpful error messages
    if (err.message.includes('Authentication failed') || err.code === 8000) {
      console.error('[db] AUTH ERROR: Check your MongoDB credentials:')
      console.error('  1. Verify username and password in DATABASE_URL')
      console.error('  2. URL-encode special characters in password (!@#$%^&* etc.)')
      console.error('  3. Check MongoDB Atlas Network Access - whitelist your IP (0.0.0.0/0 for all)')
      console.error('  4. Verify database user has correct permissions')
    } else if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
      console.error('[db] NETWORK ERROR: Cannot reach MongoDB server')
      console.error('  Check your DATABASE_URL hostname')
    } else {
      console.error('[db] Connection failed:', err.message)
    }
    
    dbConnected = false
    return false
  }
}

// Connect to DB on startup (non-blocking)
connectDb().catch(err => {
  console.error('[db] Initial connection failed:', err)
})

// --- Schemas ---
const userSchema = new mongoose.Schema(
  {
    phone: { type: String, unique: true, required: true },
    name: { type: String },
    password: { type: String, required: true },
  },
  { timestamps: true }
)

const cvSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    withPhoto: { type: Boolean, default: false },
    plan: { type: String, default: 'student' },
    title: { type: String, default: 'CV' },
  },
  { timestamps: true }
)

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    phone: { type: String, required: true },
    provider: { type: String },
    depositId: { type: String }, // PawaPay deposit ID
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    paidAt: { type: Date },
    reference: { type: String },
  },
  { timestamps: true }
)

const User = mongoose.model('User', userSchema)
const Cv = mongoose.model('Cv', cvSchema)
const Payment = mongoose.model('Payment', paymentSchema)

// --- Helpers ---
function normalizePhone(phone) {
  if (!phone) return ''
  // Remove spaces and dashes, keep leading + if present
  const trimmed = phone.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^\d]/g, '')
  return hasPlus ? `+${digits}` : digits
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), phone: user.phone }, jwtSecret, { expiresIn: '7d' })
}

async function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing token' })
  try {
    const payload = jwt.verify(token, jwtSecret)
    req.user = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

// Health check endpoint (before DB middleware)
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  })
})

// Middleware to ensure DB connection before handling requests (except health check)
app.use(async (req, res, next) => {
  // Skip DB check for health check and root endpoint
  if (req.path === '/' || req.path === '/api/health') {
    return next()
  }
  
  // Try to connect if not connected
  if (!dbConnected && mongoose.connection.readyState !== 1) {
    const connected = await connectDb()
    if (!connected && dbUrl) {
      return res.status(503).json({ error: 'Database connection unavailable' })
    }
  }
  next()
})

// --- Routes ---
app.get('/', (_req, res) => {
  res.send('API is live')
})

app.post('/api/auth/signup', async (req, res) => {
  const { phone, password, name } = req.body || {}
  if (!phone || !password || password.length < 6) {
    return res.status(400).json({ error: 'Phone number and password (>=6 chars) are required.' })
  }
  const normalizedPhone = normalizePhone(phone)
  const exists = await User.findOne({ phone: normalizedPhone }).lean()
  if (exists) return res.status(409).json({ error: 'User already exists' })
  const hash = await bcrypt.hash(password, 10)
  try {
    const user = await User.create({
      phone: normalizedPhone,
      name: name || normalizedPhone,
      password: hash,
    })
    const token = signToken(user)
    return res.json({ token, user: { id: user._id, phone: user.phone, name: user.name } })
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'User already exists' })
    }
    console.error('[signup] error', err)
    return res.status(500).json({ error: 'Signup failed' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body || {}
  if (!phone || !password) return res.status(400).json({ error: 'Phone number and password are required.' })
  const normalizedPhone = normalizePhone(phone)
  const user = await User.findOne({ phone: normalizedPhone })
  if (!user) return res.status(401).json({ error: 'Invalid phone or password' })
  const ok = await bcrypt.compare(password, user.password)
  if (!ok) return res.status(401).json({ error: 'Invalid phone or password' })
  const token = signToken(user)
  return res.json({ token, user: { id: user._id, phone: user.phone, name: user.name } })
})

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.user.sub).lean()
  if (!user) return res.status(404).json({ error: 'User not found' })
  return res.json({ user: { id: user._id, phone: user.phone, name: user.name } })
})

app.get('/api/cv', auth, async (req, res) => {
  const cvs = await Cv.find({ userId: req.user.sub }).sort({ updatedAt: -1 }).lean()
  return res.json({ cvs })
})

app.get('/api/cv/:id', auth, async (req, res) => {
  const cv = await Cv.findOne({ _id: req.params.id, userId: req.user.sub }).lean()
  if (!cv) return res.status(404).json({ error: 'Not found' })
  return res.json({ cv })
})

// Check if user has paid for the plan
async function hasPaidForPlan(userId, plan) {
  const payment = await Payment.findOne({
    userId,
    plan,
    status: 'completed'
  }).lean()
  return !!payment
}

app.post('/api/cv', auth, async (req, res) => {
  const { id, data, withPhoto, plan, title } = req.body || {}
  if (!data) return res.status(400).json({ error: 'CV data is required' })
  
  // Check if user has paid for this plan (only for new CVs)
  if (!id) {
    const paid = await hasPaidForPlan(req.user.sub, plan || 'student')
    if (!paid) {
      return res.status(402).json({ 
        error: 'Payment required', 
        message: 'You must complete payment before creating a CV',
        requiresPayment: true 
      })
    }
  }
  
  let cv
  if (id) {
    cv = await Cv.findOneAndUpdate(
      { _id: id, userId: req.user.sub },
      { data, withPhoto: !!withPhoto, plan: plan || 'student', title: title || 'CV' },
      { new: true }
    )
  } else {
    cv = await Cv.create({
      userId: req.user.sub,
      data,
      withPhoto: !!withPhoto,
      plan: plan || 'student',
      title: title || (data.fullName || 'CV'),
    })
  }
  return res.json({ cv })
})

// PawaPay API configuration - PRODUCTION
const PAWAPAY_API_TOKEN =  "eyJraWQiOiIxIiwiYWxnIjoiRVMyNTYifQ.eyJ0dCI6IkFBVCIsInN1YiI6IjE4NzUiLCJtYXYiOiIxIiwiZXhwIjoyMDgyNzA3NjEwLCJpYXQiOjE3NjcxNzQ4MTAsInBtIjoiREFGLFBBRiIsImp0aSI6IjZjOGRjOWRjLTQxZjMtNGZlYi1iN2IyLWVkNWFhZTYzMThlMSJ9.rMLwpnSCDIIgHu-p_oMV-LYxGb7WLDiKbEkrwO7YLwFgHqrey5nBF3kuQ0cwArlIRhD5-kFkjJzmUd1OexGQtw"
const PAWAPAY_API_URL = process.env.PAWAPAY_API_URL || "https://api.pawapay.io/v2" // PRODUCTION API v2

// Map frontend provider names to PawaPay provider codes
// According to PawaPay API documentation for COD (Congo):
// - Vodacom → VODACOM_MPESA_COD
// - Airtel → AIRTEL_COD
// - Orange → ORANGE_COD
function mapProviderToPawaPay(provider, country) {
  const countryCode = country?.toLowerCase() || ''
  const isCOD = countryCode.includes('congo') || countryCode.includes('rdc') || countryCode.includes('cod')
  
  if (isCOD) {
    switch (provider?.toLowerCase()) {
      case 'vodacom':
        return 'VODACOM_MPESA_COD'
      case 'airtel':
        return 'AIRTEL_COD'
      case 'orange':
        return 'ORANGE_COD'
      default:
        return 'VODACOM_MPESA_COD' // Default for COD
    }
  }
  
  // For other countries, default to Vodacom
  return 'VODACOM_MPESA_COD'
}

// Create payment request - Stripe-like redirect flow using PawaPay Payment Page
app.post('/api/payments/create', auth, async (req, res) => {
  const { plan, amount, phone, provider, country, currency = 'USD', returnUrl } = req.body || {}
  
  if (!plan || !amount) {
    return res.status(400).json({ error: 'Plan and amount are required' })
  }
  
  // returnUrl is required for Payment Page flow
  if (!returnUrl) {
    return res.status(400).json({ error: 'returnUrl is required for payment page flow' })
  }

  try {
    // Generate unique deposit ID (UUID v4 format - exactly 36 characters)
    const depositId = randomUUID()
    
    // Determine currency and country from amount/plan
    // For COD (Congo), use CDF, otherwise USD
    const isCOD = country?.toLowerCase().includes('congo') || country?.toLowerCase().includes('rdc') || country?.toLowerCase().includes('cod')
    const finalCurrency = isCOD ? 'CDF' : (currency || 'USD')
    
    // Validate amount - must be positive number
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ 
        error: 'Invalid amount',
        message: 'Amount must be a positive number'
      })
    }
    
    // Create payment record
    const payment = await Payment.create({
      userId: req.user.sub,
      plan,
      amount,
      currency: finalCurrency,
      phone: phone || '',
      provider: provider || 'vodacom',
      depositId,
      status: 'pending'
    })
    
    // Prepare PawaPay Payment Page API request payload
    // Customer message must be max 22 characters
    const customerMessage = plan === 'student' ? 'CV Student Plan' :
                           plan === 'professional' ? 'CV Pro Plan' :
                           plan === 'advanced' ? 'CV Advanced Plan' :
                           'CV Payment'
    
    // Normalize phone number if provided (optional for Payment Page, user can enter on PawaPay page)
    let normalizedPhone = ''
    let pawapayProvider = 'VODACOM_MPESA_COD' // Default provider
    
    if (phone) {
      normalizedPhone = phone.replace(/\s+/g, '').replace(/^\+/, '').trim()
      // Map provider to PawaPay format if provided
      if (provider) {
        pawapayProvider = mapProviderToPawaPay(provider, country)
      }
    }
    
    // PawaPay Payment Page API payload
    // Note: payer is required even for Payment Page flow
    // callbackUrl is configured in PawaPay Dashboard, not sent in API request
    const pawapayPayload = {
      depositId: depositId,
      amount: amount.toString(),
      currency: finalCurrency,
      clientReferenceId: `CV-${plan}-${payment._id}`,
      customerMessage: customerMessage.substring(0, 22),
      returnUrl: returnUrl // Where to redirect user after payment
      // callbackUrl is configured in PawaPay Dashboard, not here
    }
    
    // Add payer - required parameter
    if (normalizedPhone && normalizedPhone.length >= 9) {
      pawapayPayload.payer = {
        type: 'MMO',
        accountDetails: {
          phoneNumber: normalizedPhone,
          provider: pawapayProvider
        }
      }
    } else {
      // If no phone provided, PawaPay Payment Page will let user enter it
      // But we still need to provide payer structure (can be empty or with type only)
      pawapayPayload.payer = {
        type: 'MMO'
        // accountDetails will be filled by user on Payment Page
      }
    }
    
    console.log('[PawaPay] Creating Payment Page session:', {
      url: `${PAWAPAY_API_URL}/deposits`,
      method: 'POST',
      payload: JSON.stringify(pawapayPayload, null, 2),
      returnUrl: returnUrl
      // Note: callbackUrl is configured in PawaPay Dashboard
    })
    
    // Call PawaPay API to create payment with Payment Page flow
    // Adding returnUrl and callbackUrl enables Payment Page mode
    // This returns a redirectUrl that the user should be sent to
    const pawapayResponse = await fetch(`${PAWAPAY_API_URL}/deposits`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAWAPAY_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pawapayPayload)
    })
    
    console.log('[PawaPay] Response Status:', pawapayResponse.status, pawapayResponse.statusText)

    if (!pawapayResponse.ok) {
      let errorData = {}
      let errorText = ''
      try {
        errorText = await pawapayResponse.text()
        errorData = JSON.parse(errorText)
      } catch (e) {
        errorData = { error: errorText || 'Unknown error' }
      }
      
      console.error('[PawaPay] Error Response:', {
        status: pawapayResponse.status,
        statusText: pawapayResponse.statusText,
        errorData,
        errorText
      })
      
      await Payment.findByIdAndUpdate(payment._id, { status: 'failed' })
      
      const errorMessage = errorData.failureReason?.failureMessage || 
                          errorData.errorMessage || 
                          errorData.error || 
                          'PawaPay API error'
      
      return res.status(pawapayResponse.status || 500).json({ 
        error: 'Payment initiation failed', 
        details: errorData,
        message: errorMessage
      })
    }

    const pawapayData = await pawapayResponse.json()
    
    console.log('[PawaPay] Payment Page session created:', {
      depositId: pawapayData.depositId || depositId,
      redirectUrl: pawapayData.redirectUrl,
      status: pawapayData.status,
      fullResponse: JSON.stringify(pawapayData, null, 2)
    })
    
    // Payment Page API returns a redirectUrl that user should be redirected to
    const redirectUrl = pawapayData.redirectUrl || pawapayData.url
    
    if (!redirectUrl) {
      console.error('[PawaPay] No redirectUrl in response:', pawapayData)
      await Payment.findByIdAndUpdate(payment._id, { status: 'failed' })
      return res.status(500).json({ 
        error: 'Payment page creation failed',
        message: 'No redirect URL received from PawaPay',
        details: pawapayData
      })
    }
    
    // Update payment with deposit ID
    await Payment.findByIdAndUpdate(payment._id, {
      depositId: pawapayData.depositId || depositId,
      status: 'pending', // Will be updated via webhook
      reference: pawapayData.depositId || depositId
    })

    console.log('[PawaPay] ✅ Payment Page session created. Redirect user to:', redirectUrl)

    // Return redirectUrl to frontend (like Stripe checkout)
    return res.json({
      paymentId: payment._id,
      depositId: pawapayData.depositId || depositId,
      redirectUrl: redirectUrl, // Frontend will redirect user to this URL
      status: 'pending',
      message: 'Redirecting to payment page...'
    })
  } catch (err) {
    console.error('[Payment] Error:', err)
    return res.status(500).json({ error: 'Payment creation failed', message: err.message })
  }
})

// Verify payment status - polls PawaPay API
app.get('/api/payments/status/:depositId', auth, async (req, res) => {
  const { depositId } = req.params
  
  try {
    console.log('[PawaPay] Checking status for depositId:', depositId)
    
    // Check PawaPay v2 API for payment status
    const pawapayResponse = await fetch(`${PAWAPAY_API_URL}/deposits/${depositId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PAWAPAY_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })

    console.log('[PawaPay] Status check response:', {
      status: pawapayResponse.status,
      statusText: pawapayResponse.statusText
    })

    if (!pawapayResponse.ok) {
      const errorText = await pawapayResponse.text()
      console.error('[PawaPay] Status check failed:', {
        status: pawapayResponse.status,
        error: errorText
      })
      
      // If 404, the deposit might not exist yet (NOT_FOUND)
      if (pawapayResponse.status === 404) {
        return res.json({
          status: 'pending',
          pawapayStatus: 'NOT_FOUND',
          message: 'Payment request is being processed. Please check your mobile phone for an authorization prompt.'
        })
      }
      
      return res.status(pawapayResponse.status).json({ 
        error: 'Payment status check failed',
        status: 'pending',
        pawapayStatus: 'ERROR'
      })
    }

    const pawapayResponseData = await pawapayResponse.json()
    const pawapayData = pawapayResponseData.data || pawapayResponseData
    
    console.log('[PawaPay] Status data received:', {
      depositId: pawapayData.depositId,
      status: pawapayData.status,
      amount: pawapayData.amount,
      currency: pawapayData.currency,
      payer: pawapayData.payer,
      failureReason: pawapayData.failureReason
    })
    
    // Map PawaPay status to our status
    let paymentStatus = 'pending'
    if (pawapayData.status === 'COMPLETED' || pawapayData.status === 'ACCEPTED') {
      paymentStatus = 'completed'
    } else if (pawapayData.status === 'FAILED') {
      paymentStatus = 'failed'
    } else if (pawapayData.status === 'PROCESSING') {
      paymentStatus = 'processing'
    }
    
    // Update payment status in database
    const payment = await Payment.findOneAndUpdate(
      { depositId, userId: req.user.sub },
      {
        status: paymentStatus,
        paidAt: paymentStatus === 'completed' ? new Date() : undefined
      },
      { new: true }
    )

    if (!payment) {
      return res.status(404).json({ error: 'Payment record not found' })
    }

    return res.json({
      paymentId: payment._id,
      depositId: payment.depositId,
      status: payment.status,
      plan: payment.plan,
      amount: payment.amount,
      paidAt: payment.paidAt,
      pawapayStatus: pawapayData.status,
      failureReason: pawapayData.failureReason || null
    })
  } catch (err) {
    console.error('[Payment Status] Error:', err)
    return res.status(500).json({ error: 'Failed to check payment status', message: err.message })
  }
})

// PawaPay webhook callback
// This endpoint receives notifications from PawaPay when payment status changes
// Configure this URL in PawaPay Dashboard: System Configuration > Callback URLs

// GET endpoint for callback URL verification (PawaPay may test with GET)
app.get('/api/payments/callback', async (req, res) => {
  return res.json({ 
    success: true,
    message: 'PawaPay callback endpoint is active',
    endpoint: '/api/payments/callback',
    method: 'POST',
    note: 'This endpoint accepts POST requests from PawaPay webhooks'
  })
})

// POST endpoint for actual webhook callbacks from PawaPay
app.post('/api/payments/callback', async (req, res) => {
  console.log('[PawaPay Callback] Received webhook:', {
    body: req.body,
    headers: req.headers,
    timestamp: new Date().toISOString()
  })
  
  try {
    // PawaPay sends webhook with deposit information
    // Format: { data: { depositId, status, amount, currency, payer, failureReason, ... } }
    const webhookData = req.body?.data || req.body
    const depositId = webhookData?.depositId || req.body?.depositId
    const status = webhookData?.status || req.body?.status
    const failureReason = webhookData?.failureReason || req.body?.failureReason
    
    if (!depositId) {
      console.error('[PawaPay Callback] Missing depositId in webhook')
      return res.status(400).json({ error: 'Missing depositId' })
    }
    
    // Find payment by depositId
    const payment = await Payment.findOne({ depositId })
    if (!payment) {
      console.error('[PawaPay Callback] Payment not found for depositId:', depositId)
      // Still return 200 to prevent PawaPay from retrying
      return res.json({ success: false, message: 'Payment not found' })
    }

    // Map PawaPay status to our status
    let paymentStatus = 'pending'
    if (status === 'COMPLETED') {
      paymentStatus = 'completed'
    } else if (status === 'FAILED') {
      paymentStatus = 'failed'
    } else if (status === 'PROCESSING' || status === 'ACCEPTED') {
      paymentStatus = 'processing'
    }
    
    // Update payment status
    await Payment.findByIdAndUpdate(payment._id, {
      status: paymentStatus,
      paidAt: paymentStatus === 'completed' ? new Date() : undefined,
      reference: depositId
    })
    
    console.log('[PawaPay Callback] ✅ Payment updated:', {
      depositId,
      paymentId: payment._id,
      oldStatus: payment.status,
      newStatus: paymentStatus,
      pawapayStatus: status,
      failureReason: failureReason?.failureMessage || null
    })

    // Always return 200 to acknowledge receipt
    // PawaPay will retry if we return an error status
    return res.json({ 
      success: true,
      depositId,
      status: paymentStatus,
      message: 'Callback processed successfully'
    })
  } catch (err) {
    console.error('[PawaPay Callback] Error processing webhook:', err)
    // Still return 200 to prevent infinite retries, but log the error
    return res.status(200).json({ 
      success: false, 
      error: 'Callback processing failed',
      message: err.message 
    })
  }
})

// Health check endpoint
app.get('/api/health', async (req, res) => {
  return res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Backend is running'
  })
})

// Check if user has paid
app.get('/api/payments/check/:plan', auth, async (req, res) => {
  const { plan } = req.params
  const paid = await hasPaidForPlan(req.user.sub, plan)
  return res.json({ paid })
})

// ⚠️ Dev-only helper to clear all users (for local testing only)
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/debug/clear-users', async (_req, res) => {
    try {
      await User.deleteMany({})
      return res.json({ ok: true })
    } catch (err) {
      console.error('[debug] clear-users error', err)
      return res.status(500).json({ error: 'Failed to clear users' })
    }
  })
}

// 404 handler
app.use((_req, res) => {
  res.status(404).send("Sorry can't find that!")
})

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal server error', message: err.message })
})

// Export for Vercel serverless
module.exports = app
