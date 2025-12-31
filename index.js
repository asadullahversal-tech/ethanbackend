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
const PAWAPAY_API_TOKEN =  "eyJraWQiOiIxIiwiYWxnIjoiRVMyNTYifQ.eyJ0dCI6IkFBVCIsInN1YiI6IjE4NzUiLCJtYXYiOiIxIiwiZXhwIjoyMDgyNTUzNjA5LCJpYXQiOjE3NjcwMjA4MDksInBtIjoiREFGLFBBRiIsImp0aSI6ImJjZDEwNjViLWI2N2EtNGZlMi04OTBmLTQ0NjI5ZTRlZTAyMiJ9.VjBkfAQilr332UntoyyK_3IRvyWwqdQ1f3W7jJJ91bauSyvA3V7X5VBVqDK8fvZYX9Byggwh2Pkqk7Q8EyKipg"
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

// Create payment request
app.post('/api/payments/create', auth, async (req, res) => {
  const { plan, amount, phone, provider, country, currency = 'USD' } = req.body || {}
  
  if (!plan || !amount || !phone) {
    return res.status(400).json({ error: 'Plan, amount, and phone are required' })
  }

  try {
    // Generate unique deposit ID (UUID v4 format - exactly 36 characters)
    // Using crypto.randomUUID() for proper UUID v4 generation
    const depositId = randomUUID()
    
    // Create payment record
    const payment = await Payment.create({
      userId: req.user.sub,
      plan,
      amount,
      currency: currency || 'USD',
      phone,
      provider: provider || 'mtn',
      depositId,
      status: 'pending'
    })

    // Normalize phone number for PawaPay
    // PawaPay expects: country code + number without + prefix (e.g., "243998138612" for Congo)
    let normalizedPhone = phone.replace(/\s+/g, '').replace(/^\+/, '').trim()
    
    // Validate phone number format for Congo (should start with 243 and be 12 digits total)
    if (normalizedPhone.length < 9 || normalizedPhone.length > 15) {
      return res.status(400).json({ 
        error: 'Invalid phone number format',
        message: 'Phone number must be between 9 and 15 digits (e.g., 243998138612)'
      })
    }
    
    // Map provider to PawaPay format
    const pawapayProvider = mapProviderToPawaPay(provider || 'mtn', country)
    
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
    
    // Prepare PawaPay v2 API request payload
    // Customer message must be max 22 characters
    const customerMessage = plan === 'student' ? 'CV Student Plan' :
                           plan === 'professional' ? 'CV Pro Plan' :
                           plan === 'advanced' ? 'CV Advanced Plan' :
                           'CV Payment'
    
    const pawapayPayload = {
      depositId: depositId,
      payer: {
        type: 'MMO',
        accountDetails: {
          phoneNumber: normalizedPhone,
          provider: pawapayProvider
        }
      },
      amount: amount.toString(),
      currency: finalCurrency,
      clientReferenceId: `CV-${plan}-${payment._id}`,
      customerMessage: customerMessage.substring(0, 22) // Ensure max 22 characters
    }
    
    console.log('[PawaPay] Creating deposit request:', {
      url: `${PAWAPAY_API_URL}/deposits`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAWAPAY_API_TOKEN.substring(0, 20)}...`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(pawapayPayload, null, 2),
      phoneNumber: normalizedPhone,
      provider: pawapayProvider,
      amount: amount.toString(),
      currency: finalCurrency
    })
    
    // Call PawaPay v2 API to create payment
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
    
    console.log('[PawaPay] Deposit created successfully:', {
      depositId: pawapayData.depositId,
      status: pawapayData.status,
      nextStep: pawapayData.nextStep,
      created: pawapayData.created,
      fullResponse: JSON.stringify(pawapayData, null, 2)
    })
    
    // Update payment with deposit ID and status
    // ACCEPTED means payment was successfully initiated and user should receive prompt
    // Other statuses: PENDING, PROCESSING, COMPLETED, FAILED
    const initialStatus = pawapayData.status === 'ACCEPTED' ? 'processing' : 
                         pawapayData.status === 'FAILED' ? 'failed' : 'pending'
    
    await Payment.findByIdAndUpdate(payment._id, {
      depositId: pawapayData.depositId || depositId,
      status: initialStatus,
      reference: pawapayData.depositId || depositId
    })

    // Log important info for debugging
    if (pawapayData.status === 'ACCEPTED') {
      console.log('[PawaPay] ✅ Payment initiated successfully. User should receive mobile authorization prompt on:', normalizedPhone)
    } else {
      console.log('[PawaPay] ⚠️ Payment status:', pawapayData.status, '- User may not receive prompt yet')
    }

    return res.json({
      paymentId: payment._id,
      depositId: pawapayData.depositId || depositId,
      status: initialStatus,
      nextStep: pawapayData.nextStep || 'FINAL_STATUS',
      pawapayStatus: pawapayData.status,
      message: pawapayData.status === 'ACCEPTED' 
        ? 'Payment initiated. Please check your mobile phone for an authorization prompt (USSD or SMS).'
        : 'Payment request received. Status: ' + pawapayData.status
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
