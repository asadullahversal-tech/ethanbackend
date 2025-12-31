#!/bin/bash

# Test PawaPay Payment Creation
# Replace YOUR_JWT_TOKEN with your actual authentication token

curl -X POST https://ethanbackend.vercel.app/api/payments/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "plan": "student",
    "amount": 1,
    "phone": "243998138612",
    "provider": "airtel",
    "country": "COD",
    "currency": "CDF",
    "returnUrl": "https://ethancv-sage.vercel.app/?payment=success&plan=student"
  }'

