// src/utils/getPayPalAccessToken.ts
import axios from "axios";

export async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const mode = process.env.PAYPAL_MODE || 'sandbox';

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const baseUrl = mode === 'live' 
    ? 'https://api-m.paypal.com' 
    : 'https://api-m.sandbox.paypal.com';

  try {
    console.log(`🔑 Getting PayPal access token from ${baseUrl}`);
    
    const response = await axios.post(
      `${baseUrl}/v1/oauth2/token`,
      new URLSearchParams({ grant_type: "client_credentials" }),
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log('✅ PayPal access token obtained successfully');
    return response.data.access_token;
  } catch (error: any) {
    console.error("❌ Failed to get PayPal access token:", error?.response?.data || error.message);
    throw new Error(`PayPal authentication failed: ${error?.response?.data?.error_description || error.message}`);
  }
}
