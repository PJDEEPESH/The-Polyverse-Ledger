// // src/components/PayPalSubscription.tsx
// import { useEffect, useRef, useState, useCallback } from "react";
// import axios from "axios";

// declare global {
//   interface Window {
//     paypal: any;
//   }
// }

// interface PayPalSubscriptionProps {
//   planId: string;
//   prismaPlanId: string;
//   containerId: string;
//   userId: string;
//   blockchainId?: string;
//   walletAddress?: string;
//   amount?: number;
//   dueDate?: string;
//   onApprove?: (subscriptionId: string) => void;
//   onError?: (error: string) => void;
//   onCancel?: () => void;
//   apiBaseUrl?: string;
// }

// let isScriptLoaded = false;
// let scriptPromise: Promise<void> | null = null;

// const PayPalSubscription = ({
//   planId,
//   prismaPlanId,
//   containerId,
//   userId,
//   blockchainId,
//   walletAddress,
//   amount,
//   dueDate,
//   onApprove,
//   onError,
//   onCancel,
//   apiBaseUrl = "http://localhost:3000",
// }: PayPalSubscriptionProps) => {
//   const mountedRef = useRef(true);
//   const containerRef = useRef<HTMLDivElement>(null);
//   const buttonsRef = useRef<any>(null);
//   const initializationRef = useRef(false);

//   const [isLoading, setIsLoading] = useState(true);
//   const [error, setError] = useState<string | null>(null);

//   // ✅ REPLACE WITH YOUR ACTUAL SANDBOX CLIENT ID
//   const CLIENT_ID = "YOUR_SANDBOX_CLIENT_ID_HERE"; // You need to replace this

//   const loadPayPalScript = useCallback((): Promise<void> => {
//     if (isScriptLoaded && window.paypal) return Promise.resolve();
//     if (scriptPromise) return scriptPromise;

//     console.log('🔄 Loading PayPal SDK for container:', containerId);

//     scriptPromise = new Promise((resolve, reject) => {
//       // Remove existing script
//       const existingScript = document.getElementById("paypal-sdk-script");
//       if (existingScript) {
//         existingScript.remove();
//         console.log('🗑️ Removed existing PayPal script');
//       }

//       const script = document.createElement("script");
      
//       // ✅ Use sandbox PayPal SDK
//       script.src = `https://www.sandbox.paypal.com/sdk/js?client-id=${CLIENT_ID}&vault=true&intent=subscription&debug=true`;
//       script.id = "paypal-sdk-script";
//       script.async = true;

//       script.onload = () => {
//         console.log('✅ PayPal SDK loaded successfully');
//         setTimeout(() => {
//           if (window.paypal) {
//             isScriptLoaded = true;
//             resolve();
//           } else {
//             console.error('❌ PayPal object not found after script load');
//             reject(new Error("PayPal SDK loaded but window.paypal not available"));
//           }
//         }, 500);
//       };

//       script.onerror = (event) => {
//         console.error('❌ PayPal SDK failed to load:', event);
//         console.error('❌ Check client ID and network connection');
//         scriptPromise = null;
//         isScriptLoaded = false;
//         reject(new Error("Failed to load PayPal SDK - Invalid client ID or network error"));
//       };

//       document.head.appendChild(script);
//     });

//     return scriptPromise;
//   }, [CLIENT_ID, containerId]);

//   const cleanupContainer = useCallback(() => {
//     const container = document.getElementById(containerId);
//     if (container) {
//       container.innerHTML = "";
//     }
//   }, [containerId]);

//   const handleApprove = useCallback(async (data: any) => {
//     if (!mountedRef.current) return;
    
//     try {
//       setIsLoading(true);
//       setError(null);
//       console.log('🎯 PayPal subscription approved:', data.subscriptionID);

//       // Create invoice if required data is provided
//       let invoiceId = null;
//       if (walletAddress && blockchainId && amount && dueDate) {
//         try {
//           console.log('📄 Creating invoice...');
//           const invoiceRes = await axios.post(`${apiBaseUrl}/api/v1/invoices`, {
//             walletAddress,
//             blockchainId,
//             amount,
//             dueDate,
//             tokenized: false,
//             subscriptionId: data.subscriptionID,
//           });
//           invoiceId = invoiceRes.data?.data?.id;
//           console.log('✅ Invoice created:', invoiceId);
//         } catch (invoiceError: any) {
//           console.warn('⚠️ Invoice creation failed:', invoiceError?.response?.data || invoiceError.message);
//         }
//       }

//       // Create subscription in backend
//       const subscriptionData = {
//         plan_id: planId,
//         userId,
//         prismaPlanId,
//         ...(invoiceId && { invoiceId })
//       };

//       console.log('📤 Creating backend subscription:', subscriptionData);

//       const response = await axios.post(`${apiBaseUrl}/create-subscription`, subscriptionData);
//       console.log('✅ Backend subscription created:', response.data);

//       if (mountedRef.current) {
//         setIsLoading(false);
//         onApprove?.(data.subscriptionID);
//       }
//     } catch (err: any) {
//       const errorMessage = err?.response?.data?.error || 
//                           err?.response?.data?.details || 
//                           err.message || 
//                           "Subscription creation failed";
      
//       if (mountedRef.current) {
//         console.error("❌ Subscription error:", err?.response?.data || err.message);
//         setError(errorMessage);
//         setIsLoading(false);
//         onError?.(errorMessage);
//       }
//     }
//   }, [planId, prismaPlanId, userId, walletAddress, blockchainId, amount, dueDate, onApprove, onError, apiBaseUrl]);

//   const handleError = useCallback((err: any) => {
//     if (!mountedRef.current) return;
//     console.error("❌ PayPal button error:", err);
//     const errorMessage = "PayPal payment error occurred";
//     setError(errorMessage);
//     setIsLoading(false);
//     onError?.(errorMessage);
//   }, [onError]);

//   const handleCancel = useCallback(() => {
//     if (!mountedRef.current) return;
//     console.log("⚠️ PayPal subscription cancelled by user");
//     setIsLoading(false);
//     onCancel?.();
//   }, [onCancel]);

//   const renderButtons = useCallback(async () => {
//     if (!mountedRef.current || !window.paypal?.Buttons || initializationRef.current) {
//       return;
//     }

//     const container = document.getElementById(containerId);
//     if (!container) {
//       console.error('❌ Container not found:', containerId);
//       return;
//     }

//     try {
//       initializationRef.current = true;
//       console.log('🔄 Rendering PayPal buttons for:', containerId);

//       // Cleanup previous buttons
//       if (buttonsRef.current) {
//         try {
//           buttonsRef.current.close();
//         } catch (e) {
//           console.warn("⚠️ Error closing previous PayPal button:", e);
//         }
//         buttonsRef.current = null;
//       }

//       container.innerHTML = "";
//       await new Promise(resolve => setTimeout(resolve, 100));

//       buttonsRef.current = window.paypal.Buttons({
//         style: {
//           shape: "pill",
//           color: "gold",
//           layout: "vertical",
//           label: "subscribe",
//           height: 40,
//         },
//         createSubscription: (_data: any, actions: any) => {
//           console.log('🔄 Creating PayPal subscription with plan_id:', planId);
//           return actions.subscription.create({ 
//             plan_id: planId 
//           });
//         },
//         onApprove: handleApprove,
//         onError: handleError,
//         onCancel: handleCancel,
//       });

//       await buttonsRef.current.render(`#${containerId}`);
//       console.log('✅ PayPal buttons rendered for:', containerId);

//       if (mountedRef.current) {
//         setIsLoading(false);
//         setError(null);
//       }
//     } catch (err: any) {
//       if (mountedRef.current) {
//         console.error("❌ Error rendering PayPal buttons:", err);
//         setError(`Failed to render PayPal buttons: ${err.message}`);
//         setIsLoading(false);
//       }
//     } finally {
//       initializationRef.current = false;
//     }
//   }, [containerId, planId, handleApprove, handleError, handleCancel]);

//   const initializePayPal = useCallback(async () => {
//     if (!mountedRef.current || initializationRef.current) {
//       return;
//     }

//     try {
//       setIsLoading(true);
//       setError(null);
//       console.log('🚀 Initializing PayPal for:', containerId);
      
//       await loadPayPalScript();
      
//       if (!window.paypal) {
//         throw new Error("PayPal SDK loaded but window.paypal not available");
//       }
      
//       await renderButtons();
//     } catch (err: any) {
//       console.error("❌ PayPal initialization failed:", err);
//       setError(`PayPal initialization failed: ${err.message}`);
//       setIsLoading(false);
//     }
//   }, [loadPayPalScript, renderButtons, containerId]);

//   const retryInitialization = useCallback(() => {
//     if (initializationRef.current) return;

//     console.log('🔄 Retrying PayPal initialization for:', containerId);
//     setError(null);
//     setIsLoading(true);
//     initializationRef.current = false;

//     // Cleanup
//     if (buttonsRef.current) {
//       try {
//         buttonsRef.current.close();
//       } catch (err) {
//         console.warn("⚠️ Error closing PayPal button during retry:", err);
//       }
//       buttonsRef.current = null;
//     }

//     // Reset script loading state
//     isScriptLoaded = false;
//     scriptPromise = null;

//     cleanupContainer();
//     setTimeout(() => {
//       if (mountedRef.current) {
//         initializePayPal();
//       }
//     }, 1000);
//   }, [cleanupContainer, initializePayPal, containerId]);

//   useEffect(() => {
//     mountedRef.current = true;
//     initializationRef.current = false;
    
//     const timer = setTimeout(() => {
//       if (mountedRef.current) {
//         initializePayPal();
//       }
//     }, 100);

//     return () => {
//       clearTimeout(timer);
//       mountedRef.current = false;
//       initializationRef.current = false;
      
//       if (buttonsRef.current) {
//         try {
//           buttonsRef.current.close();
//         } catch (err) {
//           console.warn("⚠️ Error closing PayPal button on unmount:", err);
//         }
//         buttonsRef.current = null;
//       }
//       cleanupContainer();
//     };
//   }, [initializePayPal, cleanupContainer]);

//   // Show error state
//   if (error) {
//     return (
//       <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
//         <p className="text-red-700 text-sm font-medium">Payment Error</p>
//         <p className="text-red-600 text-xs mt-1 break-words">{error}</p>
//         <button
//           onClick={retryInitialization}
//           disabled={isLoading}
//           className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
//         >
//           {isLoading ? "Retrying..." : "Try Again"}
//         </button>
//       </div>
//     );
//   }

//   return (
//     <div className="paypal-subscription-container">
//       {isLoading && (
//         <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
//           <div className="flex items-center justify-center">
//             <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2" />
//             <span className="text-gray-600 text-sm">Loading PayPal...</span>
//           </div>
//         </div>
//       )}
//       <div
//         ref={containerRef}
//         id={containerId}
//         style={{
//           minHeight: isLoading ? "0" : "50px",
//           opacity: isLoading ? 0.5 : 1,
//           transition: "opacity 0.3s ease",
//         }}
//         className="paypal-buttons-container"
//       />
//     </div>
//   );
// };

// export default PayPalSubscription;
// src/components/PayPalSubscription.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";

interface PayPalSubscriptionProps {
  planId: string;
  prismaPlanId: string;
  containerId: string;
  userId: string;
  blockchainId?: string;
  walletAddress?: string;
  amount?: number;
  dueDate?: string;
  onApprove?: (subscriptionId: string) => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
  apiBaseUrl?: string;
}

const PayPalSubscription = ({
  planId,
  prismaPlanId,
  containerId,
  userId,
  blockchainId,
  walletAddress,
  amount,
  dueDate,
  onApprove,
  onError,
  onCancel,
  apiBaseUrl = "http://localhost:3000",
}: PayPalSubscriptionProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ TEMPORARY: Test mode - skip PayPal, directly call backend
  const handleTestSubscription = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      console.log('🧪 TEST MODE: Creating subscription without PayPal');
      console.log('📤 Test subscription data:', {
        userId,
        prismaPlanId,
        planId,
        amount
      });

      // Call the test endpoint that bypasses PayPal
      const response = await axios.post(`${apiBaseUrl}/test-plan-switch`, {
        userId,
        prismaPlanId
      });

      console.log('✅ Test subscription created:', response.data);

      const testSubscriptionId = `test-sub-${Date.now()}`;
      
      setIsLoading(false);
      onApprove?.(testSubscriptionId);

    } catch (err: any) {
      console.error('❌ Test subscription error:', err);
      const errorMessage = err?.response?.data?.error || err.message || 'Test subscription failed';
      setError(errorMessage);
      setIsLoading(false);
      onError?.(errorMessage);
    }
  }, [userId, prismaPlanId, planId, amount, onApprove, onError, apiBaseUrl]);

  const handleCancel = useCallback(() => {
    console.log('⚠️ Test subscription cancelled');
    onCancel?.();
  }, [onCancel]);

  const retrySubscription = useCallback(() => {
    setError(null);
    handleTestSubscription();
  }, [handleTestSubscription]);

  // Show error state
  if (error) {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700 text-sm font-medium">Subscription Error</p>
        <p className="text-red-600 text-xs mt-1 break-words">{error}</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={retrySubscription}
            disabled={isLoading}
            className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {isLoading ? "Retrying..." : "Try Again"}
          </button>
          <button
            onClick={handleCancel}
            className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="paypal-subscription-container">
      {isLoading ? (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2" />
            <span className="text-blue-600 text-sm">Processing subscription...</span>
          </div>
        </div>
      ) : (
        <button
          onClick={handleTestSubscription}
          disabled={isLoading}
          className="w-full py-3 px-4 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          🧪 Test Subscribe (${amount}/month)
        </button>
      )}
    </div>
  );
};

export default PayPalSubscription;
