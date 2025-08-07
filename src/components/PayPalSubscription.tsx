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

// PayPal SDK types
declare global {
  interface Window {
    paypal?: {
      Buttons: (config: any) => {
        render: (selector: string) => Promise<void>;
      };
    };
  }
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
  apiBaseUrl
}: PayPalSubscriptionProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonsRendered = useRef(false);

  // Safe environment variable access
  const getApiBaseUrl = useCallback(() => {
    if (apiBaseUrl) return apiBaseUrl;
    
    // For Vite (development)
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
    }
    
    // For Create React App
    if (typeof process !== 'undefined' && process.env) {
      return process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';
    }
    
    // Fallback
    return 'http://localhost:3001';
  }, [apiBaseUrl]);

  const getPayPalClientId = useCallback(() => {
    // For Vite (development)
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env.VITE_PAYPAL_CLIENT_ID;
    }
    
    // For Create React App
    if (typeof process !== 'undefined' && process.env) {
      return process.env.REACT_APP_PAYPAL_CLIENT_ID;
    }
    
    // For Next.js
    if (typeof process !== 'undefined' && process.env) {
      return process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    }
    
    return null;
  }, []);

  const PAYPAL_CLIENT_ID = getPayPalClientId();
  const API_BASE_URL = getApiBaseUrl();

  // Check if PayPal Client ID is available
  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) {
      setError('PayPal Client ID is not configured. Please check your environment variables.');
    }
  }, [PAYPAL_CLIENT_ID]);

  // Load PayPal SDK
  useEffect(() => {
    if (!PAYPAL_CLIENT_ID || error) {
      return;
    }

    const loadPayPalSDK = () => {
      if (window.paypal) {
        setSdkLoaded(true);
        return;
      }

      const existingScript = document.querySelector(`script[src*="paypal.com/sdk/js"]`);
      if (existingScript) {
        existingScript.addEventListener('load', () => setSdkLoaded(true));
        return;
      }

      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&vault=true&intent=subscription`;
      script.setAttribute('data-sdk-integration-source', 'button-factory');
      
      script.onload = () => {
        setSdkLoaded(true);
      };
      
      script.onerror = () => {
        setError('Failed to load PayPal SDK');
      };

      document.head.appendChild(script);
    };

    loadPayPalSDK();
  }, [PAYPAL_CLIENT_ID, error]);

  // Handle subscription creation via backend
  const handleSubscriptionCreation = useCallback(async (subscriptionId: string) => {
    try {
      setIsLoading(true);

      const response = await axios.post(`${API_BASE_URL}/create-subscription`, {
        plan_id: planId,
        userId,
        prismaPlanId,
        subscriptionId
      });

      setIsLoading(false);
      onApprove?.(subscriptionId);

    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err.message || 'Subscription processing failed';
      setError(errorMessage);
      setIsLoading(false);
      onError?.(errorMessage);
    }
  }, [userId, prismaPlanId, planId, onApprove, onError, API_BASE_URL]);

  // Render PayPal buttons
  useEffect(() => {
    if (!sdkLoaded || !window.paypal || buttonsRendered.current || !containerRef.current || error) {
      return;
    }

    try {
      window.paypal.Buttons({
        style: {
          shape: 'pill',
          color: 'gold',
          layout: 'vertical',
          label: 'subscribe',
          height: 40,
        },
        createSubscription: function(data: any, actions: any) {
          return actions.subscription.create({
            plan_id: planId
          });
        },
        onApprove: function(data: any, actions: any) {
          handleSubscriptionCreation(data.subscriptionID);
        },
        onError: function(err: any) {
          const errorMessage = 'PayPal subscription failed. Please try again.';
          setError(errorMessage);
          onError?.(errorMessage);
        },
        onCancel: function(data: any) {
          onCancel?.();
        }
      }).render(`#${containerId}`);

      buttonsRendered.current = true;

    } catch (renderError) {
      setError('Failed to render PayPal buttons');
    }
  }, [sdkLoaded, planId, containerId, handleSubscriptionCreation, onError, onCancel, error]);

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  const retrySubscription = useCallback(() => {
    setError(null);
    buttonsRendered.current = false;
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
  }, []);

  // Show error state
  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <div className="w-5 h-5 bg-red-100 rounded-full flex items-center justify-center">
              <span className="text-red-600 text-xs font-bold">!</span>
            </div>
          </div>
          <div className="ml-3 flex-1">
            <p className="text-red-800 text-sm font-medium">Subscription Error</p>
            <p className="text-red-700 text-xs mt-1 break-words">{error}</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={retrySubscription}
                disabled={isLoading}
                className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Retrying..." : "Try Again"}
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 bg-gray-500 text-white rounded text-xs font-medium hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state during backend processing
  if (isLoading) {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-200 border-t-blue-600 mr-3" />
          <div className="text-center">
            <p className="text-blue-800 text-sm font-medium">Processing Subscription</p>
            <p className="text-blue-600 text-xs mt-1">Please wait while we set up your plan...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while SDK loads
  if (!sdkLoaded) {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-gray-600 mr-3" />
          <div className="text-center">
            <p className="text-gray-700 text-sm font-medium">Loading PayPal</p>
            <p className="text-gray-600 text-xs mt-1">Initializing secure payment...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="paypal-subscription-container">
      <div 
        ref={containerRef}
        id={containerId}
        className="paypal-button-container min-h-[50px] flex items-center justify-center"
      />
    </div>
  );
};

export default PayPalSubscription;