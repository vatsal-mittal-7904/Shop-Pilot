import 'dotenv/config';
import { addProduct } from './src/backend/actions/merchant'
(async () => {
  try {
    await addProduct('f03ae416-4390-4ff8-b080-5a60c9b92d54', {
      name: 'Wireless Mouse',
      category: 'mouse',
      price: NaN,
      inventory: NaN,
      imageUrl: ''
    })
    console.log("Success")
  } catch (e) {
    console.error(e)
  }
})();
