# PowerShell script to test PawaPay Payment Creation
# Replace YOUR_JWT_TOKEN with your actual authentication token

$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer YOUR_JWT_TOKEN"
}

$body = @{
    plan = "student"
    amount = 1
    phone = "243998138612"
    provider = "airtel"
    country = "COD"
    currency = "CDF"
    returnUrl = "https://ethancv-sage.vercel.app/?payment=success&plan=student"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://ethanbackend.vercel.app/api/payments/create" `
    -Method POST `
    -Headers $headers `
    -Body $body

