import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'onboarding@resend.dev'; // Default for testing. Verify a domain in Resend dashboard to change this.

export const sendResetEmail = async (email: string, token: string) => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${token}`;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #333;">Password Reset</h2>
          <p>You requested a password reset for your Vibe account.</p>
          <p>Click the button below to reset your password. This link expires in 1 hour.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #000; color: #fff; padding: 15px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
          </div>
          <p style="font-size: 12px; color: #999;">Or copy this link: ${resetUrl}</p>
        </div>
      `,
    });
    console.log(`[Email] Password reset sent to ${email}`);
  } catch (error) {
    console.error('[Email] Failed to send password reset:', error);
    throw new Error('Failed to send email');
  }
};

export const sendOtpEmail = async (email: string, otp: string) => {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Your Security Code',
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px; text-align: center;">
          <h2 style="color: #333;">Security Verification</h2>
          <p>Use the code below to complete your request.</p>
          <div style="background: #f4f4f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #000;">${otp}</span>
          </div>
          <p style="font-size: 12px; color: #666;">This code expires in 10 minutes. Do not share it with anyone.</p>
        </div>
      `,
    });
    console.log(`[Email] OTP sent to ${email}`);
  } catch (error) {
    console.error('[Email] Failed to send OTP:', error);
    // Don't throw here to avoid crashing the flow if email fails in dev (usually due to unverified 'to' address in free tier)
    // But since user has a key, it should probably work if they verify the domain or send to their own email.
    // For Resend free tier, you can only send to the email you signed up with unless you verify a domain.
    throw new Error('Failed to send OTP email'); 
  }
};
