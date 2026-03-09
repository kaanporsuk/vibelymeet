import { supabase } from "@/integrations/supabase/client";

export const sendNotification = async (params: {
  user_id: string;
  category: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  image_url?: string;
  bypass_preferences?: boolean;
}) => {
  try {
    await supabase.functions.invoke("send-notification", {
      body: params,
    });
  } catch (error) {
    console.error("Failed to send notification:", error);
    // Non-critical — never crash the app if a notification fails
  }
};
