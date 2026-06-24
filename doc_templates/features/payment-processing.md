# Payment Processing Feature

## Overview
This document provides a deep dive into the payment processing feature, explaining how payments flow through the system, integration with payment providers, error handling, and security considerations.

## System Architecture

### High-Level Flow
```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client  │────▶│   API    │────▶│ Temporal │────▶│  Stripe  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                 │                 │
     │                │                 │                 │
     └────────────────┴─────────────────┴─────────────────┘
                  Payment Status Updates
```

### Components

#### 1. Payment API Endpoint
- **Endpoint**: `POST /api/v1/payments`
- **Authentication**: Required (JWT)
- **Rate Limit**: 10 requests per minute per user

#### 2. Payment Service
- Handles payment business logic
- Validates payment data
- Initiates Temporal workflow
- Returns immediate response to client

#### 3. Temporal Workflow
- Orchestrates payment processing
- Handles retries and timeouts
- Manages state transitions
- Sends notifications

#### 4. Payment Provider (Stripe)
- Processes actual payment
- Provides webhooks for status updates
- Handles disputes and refunds

## Payment Flow

### Step-by-Step Process

#### 1. Client Initiates Payment
```typescript
// Client-side code
const response = await fetch('/api/v1/payments', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    amount: 5000, // $50.00 in cents
    currency: 'usd',
    payment_method: 'pm_xxx', // Stripe payment method ID
    description: 'Order #12345',
    metadata: {
      order_id: '12345',
      customer_id: 'cust_xxx'
    }
  })
});

const { payment_id, status } = await response.json();
// payment_id: "pay_xxx"
// status: "processing"
```

#### 2. API Validates Request
```typescript
// API endpoint handler
async function createPayment(req, res) {
  // Validate authentication
  const user = await authenticate(req);
  
  // Validate payment data
  const paymentData = validatePaymentSchema(req.body);
  
  // Check for duplicate payment (idempotency)
  const existing = await checkDuplicatePayment(
    user.id,
    paymentData.metadata.order_id
  );
  if (existing) {
    return res.status(200).json(existing);
  }
  
  // Create payment record
  const payment = await db.payments.create({
    user_id: user.id,
    amount: paymentData.amount,
    currency: paymentData.currency,
    status: 'pending',
    metadata: paymentData.metadata
  });
  
  // Start Temporal workflow
  await temporal.startWorkflow({
    workflowId: `payment-${payment.id}`,
    taskQueue: 'payment-processing',
    args: [payment.id, paymentData]
  });
  
  return res.status(201).json({
    payment_id: payment.id,
    status: 'processing'
  });
}
```

#### 3. Temporal Workflow Processes Payment
```typescript
// Temporal workflow
async function processPaymentWorkflow(
  paymentId: string,
  paymentData: PaymentData
) {
  // Update status to processing
  await updatePaymentStatus(paymentId, 'processing');
  
  try {
    // Charge payment via Stripe (with retries)
    const charge = await activities.chargePayment(paymentData);
    
    // Update status to succeeded
    await updatePaymentStatus(paymentId, 'succeeded', {
      stripe_charge_id: charge.id,
      completed_at: new Date()
    });
    
    // Send success notification
    await activities.sendPaymentSuccessEmail(paymentId);
    
    // Update order status
    await activities.updateOrderStatus(
      paymentData.metadata.order_id,
      'paid'
    );
    
    return { success: true, charge_id: charge.id };
    
  } catch (error) {
    // Handle payment failure
    await updatePaymentStatus(paymentId, 'failed', {
      error_message: error.message,
      failed_at: new Date()
    });
    
    // Send failure notification
    await activities.sendPaymentFailureEmail(paymentId);
    
    return { success: false, error: error.message };
  }
}
```

#### 4. Stripe Webhook Updates
```typescript
// Webhook handler
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  
  // Verify webhook signature
  const event = stripe.webhooks.constructEvent(
    req.body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET
  );
  
  switch (event.type) {
    case 'charge.succeeded':
      await handleChargeSucceeded(event.data.object);
      break;
      
    case 'charge.failed':
      await handleChargeFailed(event.data.object);
      break;
      
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object);
      break;
      
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
  }
  
  res.status(200).send({ received: true });
}
```

## Database Schema

### payments table
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL, -- Amount in cents
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL, -- pending, processing, succeeded, failed, refunded
  payment_method TEXT, -- Stripe payment method ID
  stripe_charge_id TEXT,
  stripe_payment_intent_id TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  
  CONSTRAINT valid_amount CHECK (amount > 0),
  CONSTRAINT valid_currency CHECK (currency IN ('usd', 'eur', 'gbp')),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded'))
);

CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_created_at ON payments(created_at);
CREATE INDEX idx_payments_stripe_charge_id ON payments(stripe_charge_id);
```

### payment_events table (audit log)
```sql
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  event_type TEXT NOT NULL, -- created, processing, succeeded, failed, refunded
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payment_events_payment_id ON payment_events(payment_id);
CREATE INDEX idx_payment_events_created_at ON payment_events(created_at);
```

## Error Handling

### Error Types

#### 1. Validation Errors (400)
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid payment data",
    "details": {
      "amount": "Amount must be greater than 0",
      "currency": "Unsupported currency"
    }
  }
}
```

#### 2. Authentication Errors (401)
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

#### 3. Payment Method Errors (402)
```json
{
  "error": {
    "code": "PAYMENT_METHOD_ERROR",
    "message": "Payment method declined",
    "details": {
      "decline_code": "insufficient_funds",
      "stripe_error": "Your card has insufficient funds."
    }
  }
}
```

#### 4. Rate Limit Errors (429)
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many payment requests. Please try again in 60 seconds.",
    "retry_after": 60
  }
}
```

#### 5. Server Errors (500)
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An error occurred processing your payment. Please try again.",
    "support_id": "error_xxx"
  }
}
```

### Retry Logic

#### Temporal Activity Retries
```typescript
const activities = proxyActivities<PaymentActivities>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '1s',
    maximumInterval: '60s',
    backoffCoefficient: 2,
    maximumAttempts: 5,
    nonRetryableErrorTypes: [
      'ValidationError',
      'PaymentDeclinedError',
      'InsufficientFundsError'
    ]
  }
});
```

#### Webhook Retry Strategy
- Stripe automatically retries webhooks on failure
- Retries with exponential backoff: 1h, 2h, 4h, 8h, 16h, 24h
- We acknowledge webhook immediately (200 response)
- Process webhook asynchronously in case of temporary failures

## Security

### Security Measures

#### 1. PCI Compliance
- Never store raw credit card data
- Use Stripe.js to collect card details client-side
- Card data goes directly to Stripe, never touches our servers
- Store only Stripe payment method IDs

#### 2. Authentication
- All payment endpoints require JWT authentication
- Verify user owns the payment method
- Check user permissions before refunds

#### 3. Idempotency
- Use idempotency keys to prevent duplicate charges
- Check for duplicate payments using order_id
- Return existing payment if found

```typescript
async function ensureIdempotent(userId, orderId) {
  const existing = await db.payments.findOne({
    user_id: userId,
    'metadata.order_id': orderId,
    status: { $in: ['processing', 'succeeded'] }
  });
  
  if (existing) {
    return existing; // Don't create duplicate payment
  }
}
```

#### 4. Webhook Security
- Verify Stripe webhook signatures
- Use webhook secrets
- Validate event data

```typescript
// Verify webhook signature
try {
  const event = stripe.webhooks.constructEvent(
    req.body,
    signature,
    webhookSecret
  );
} catch (err) {
  return res.status(400).send(`Webhook Error: ${err.message}`);
}
```

#### 5. Rate Limiting
- 10 payment requests per minute per user
- 100 webhook requests per minute per IP
- Prevents abuse and DDoS

#### 6. Logging
- Log all payment attempts (sanitized, no card data)
- Log webhook events
- Monitor for suspicious patterns

```typescript
logger.info('Payment initiated', {
  payment_id: payment.id,
  user_id: user.id,
  amount: payment.amount,
  currency: payment.currency,
  // Never log: card numbers, CVV, etc.
});
```

## Monitoring and Alerts

### Key Metrics
- Payment success rate (target: > 95%)
- Average payment processing time (target: < 5s)
- Failed payment rate by reason
- Webhook processing time
- Revenue processed

### Alerts
- Payment success rate < 90% (5 minutes)
- Payment processing time > 10s (10 minutes)
- Webhook failures > 10 in 5 minutes
- Unusual spike in failed payments

### Dashboard
- Real-time payment volume
- Success/failure breakdown
- Revenue trends
- Top failure reasons
- Geographic distribution

## Testing

### Unit Tests
```typescript
describe('Payment Service', () => {
  it('should create payment with valid data', async () => {
    const payment = await paymentService.createPayment({
      user_id: 'user_123',
      amount: 5000,
      currency: 'usd',
      payment_method: 'pm_xxx'
    });
    
    expect(payment.id).toBeDefined();
    expect(payment.status).toBe('pending');
  });
  
  it('should reject payment with invalid amount', async () => {
    await expect(
      paymentService.createPayment({
        user_id: 'user_123',
        amount: -100, // Invalid
        currency: 'usd',
        payment_method: 'pm_xxx'
      })
    ).rejects.toThrow('Invalid amount');
  });
});
```

### Integration Tests
```typescript
describe('Payment API', () => {
  it('should process payment end-to-end', async () => {
    const response = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 5000,
        currency: 'usd',
        payment_method: testPaymentMethod,
        metadata: { order_id: 'test_123' }
      });
    
    expect(response.status).toBe(201);
    expect(response.body.payment_id).toBeDefined();
    
    // Wait for workflow to complete
    await waitForPaymentStatus(response.body.payment_id, 'succeeded');
  });
});
```

### Stripe Test Cards
```
Success: 4242 4242 4242 4242
Decline (insufficient funds): 4000 0000 0000 9995
Decline (generic): 4000 0000 0000 0002
3D Secure required: 4000 0027 6000 3184
```

## Performance Optimization

### Database Indexes
- Index on `user_id` for user payment history
- Index on `status` for filtering by status
- Index on `created_at` for sorting
- Index on `stripe_charge_id` for webhook lookups

### Caching
- Cache user payment methods (5 minutes)
- Cache successful payment status (until refunded)
- Don't cache sensitive payment data

### Async Processing
- Use Temporal for heavy operations
- Process webhooks asynchronously
- Send notifications in background

## Future Improvements
- [ ] Support for additional payment methods (Apple Pay, Google Pay)
- [ ] Subscription payments
- [ ] Payment installments
- [ ] Multi-currency support
- [ ] Automatic retry of failed payments
- [ ] Payment analytics dashboard
- [ ] Fraud detection integration

## References
- [Stripe API Documentation](https://stripe.com/docs/api)
- [PCI Compliance Guide](https://www.pcisecuritystandards.org/)
- [Temporal Documentation](https://docs.temporal.io/)
- [Payment Security Best Practices](https://stripe.com/docs/security/guide)

## Change Log
| Date | Change | Author |
|------|--------|--------|
| 2024-01-01 | Initial document | Jane Doe |
| 2024-01-15 | Added webhook security | John Smith |
| 2024-02-01 | Added monitoring section | Jane Doe |
