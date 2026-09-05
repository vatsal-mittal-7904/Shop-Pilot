import Razorpay from 'razorpay'

const isProduction = process.env.NODE_ENV === 'production' && process.env.APP_ENV !== 'demo'

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key',
  key_secret: process.env.RAZORPAY_KEY_SECRET || (isProduction ? (() => { throw new Error('RAZORPAY_KEY_SECRET is required') })() : 'dummy_secret'),
})

