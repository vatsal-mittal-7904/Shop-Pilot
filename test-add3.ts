import 'dotenv/config';
import { addProduct } from './src/backend/actions/merchant'
(async () => {
  try {
    await addProduct('f03ae416-4390-4ff8-b080-5a60c9b92d54', {
      name: 'Noise Cancelling Headphone',
      category: 'headphones',
      price: parseInt("12999") * 100,
      inventory: parseInt("23"),
      imageUrl: 'https://www.google.com/imgres?q=Noise'
    })
    console.log("Success")
  } catch (e) {
    console.error(e)
  }
})();
