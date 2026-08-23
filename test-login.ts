import 'dotenv/config'
import { authenticate } from './src/backend/actions/auth'

async function main() {
  try {
    const res = await authenticate({
      email: 'admin@technest.com',
      password: 'technest-demo-2026',
      mode: 'sign-in'
    })
    console.log("Login Success:", res)
  } catch (e: any) {
    console.error("Login Failed:", e.message)
  }
}
main()
