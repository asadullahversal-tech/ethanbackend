# Test payment creation with phone number +243 998 138 612
# This tests the phone normalization fix

$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OTUyZDUxYzE0MDk2YTg5OTAwZTJkOGIiLCJwaG9uZSI6IjI0Mzk5ODEzODYxMiIsImlhdCI6MTc2NzE3Nzc4OCwiZXhwIjoxNzY3NzgyNTg4fQ.9AsBu5QxaqtVvHciCHTD0KHWkESlbqSE91L3YdVeknE"
}

$body = @{
    plan = "student"
    amount = 1500
    phone = "+243 998 138 612"
    provider = "airtel"
    country = "COD"
    currency = "CDF"
    returnUrl = "https://ethancv-sage.vercel.app/?payment=success&plan=student"
} | ConvertTo-Json

Write-Host "Testing payment creation with phone: +243 998 138 612" -ForegroundColor Cyan
Write-Host "Payload: $body" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "https://ethanbackend.vercel.app/api/payments/create" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ContentType "application/json"
    
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Yellow
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Error!" -ForegroundColor Red
    $statusCode = $null
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
        
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            $reader.Close()
            Write-Host "Error Response:" -ForegroundColor Yellow
            $responseBody | ConvertFrom-Json | ConvertTo-Json -Depth 10
        } catch {
            Write-Host "Could not parse error response" -ForegroundColor Red
        }
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

