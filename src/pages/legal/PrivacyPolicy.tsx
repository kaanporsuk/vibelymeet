import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
  <div className="min-h-screen bg-background text-foreground">
    {/* Sticky Nav Header */}
    <header className="sticky top-0 z-40 glass-card border-b border-border/50 px-4 py-4">
      <div className="flex items-center gap-3 max-w-3xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-xl font-display font-bold text-foreground">Privacy Policy</h1>
      </div>
    </header>

    {/* Content */}
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-muted-foreground mb-10">Effective date: March 2026</p>

      <div className="space-y-8 text-sm leading-relaxed text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-3">
        <section>
          <h2>1. Introduction</h2>
          <p>
            Vibely operates the mobile application and website at vibelymeet.com. This policy explains how we collect, use, and protect your data. By using Vibely you agree to this policy. We comply with GDPR.
          </p>
          <p className="mt-2">Data Controller: Vibely — privacy@vibelymeet.com</p>
        </section>

        <section>
          <h2>2. Data We Collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Account info:</strong> phone, email, name, date of birth, gender, preferences</li>
            <li><strong>Profile info:</strong> photos, video intro, bio, location (city only), vibe tags</li>
            <li><strong>Usage data:</strong> features used, swipes, matches, sessions</li>
            <li><strong>Payment data:</strong> processed by Stripe (we never store full card numbers)</li>
            <li><strong>Verification:</strong> selfie for photo verification (deleted after comparison)</li>
          </ul>
        </section>

        <section>
          <h2>3. How We Use Your Data</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Providing and improving the Service</li>
            <li>Matching you with compatible profiles</li>
            <li>Safety, moderation, and fraud prevention</li>
            <li>Processing payments</li>
            <li>Sending match and event notifications</li>
            <li>We do NOT sell your data or serve third-party ads</li>
          </ul>
        </section>

        <section>
          <h2>4. Sharing Your Data</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>With other users:</strong> your profile (never your contact details)</li>
            <li><strong>With service providers:</strong> Supabase, Stripe, Daily.co, Bunny.net, Twilio, Resend, PostHog, Sentry</li>
            <li>For legal compliance when required by law</li>
            <li>We never sell your personal data</li>
          </ul>
        </section>

        <section>
          <h2>5. Data Retention</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Account data: while active + 30 days after deletion</li>
            <li>Messages: 12 months after conversation ends</li>
            <li>Payment records: 7 years (EU tax law)</li>
            <li>Deletion requests processed within 30 days</li>
          </ul>
        </section>

        <section>
          <h2>6. Security</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>TLS encryption in transit and at rest</li>
            <li>Row-Level Security on all database tables</li>
            <li>Signed URLs for all media access</li>
            <li>Phone and photo verification on accounts</li>
          </ul>
        </section>

        <section>
          <h2>7. Your Rights (GDPR)</h2>
          <p>
            You have the right to: access, rectification, erasure, restriction, portability, objection, and withdraw consent.
          </p>
          <p className="mt-2">
            To exercise your rights, email privacy@vibelymeet.com or use Settings → Delete My Account in the app. You can also complain to your local Data Protection Authority.
          </p>
        </section>

        <section>
          <h2>8. Age Requirement</h2>
          <p>
            Vibely is strictly 18+. We do not knowingly collect data from anyone under 18. Report underage accounts to safety@vibelymeet.com.
          </p>
        </section>

        <section>
          <h2>9. Changes</h2>
          <p>
            Material changes will be notified 14 days in advance by email or in-app notification.
          </p>
        </section>

        <section>
          <h2>10. Contact</h2>
          <p>privacy@vibelymeet.com</p>
          <p>
            <Link to="/delete-account" className="text-neon-violet hover:underline">
              vibelymeet.com/delete-account
            </Link>
          </p>
        </section>
      </div>
    </main>

    {/* Footer */}
    <footer className="border-t border-border/40 px-6 py-6 text-center text-xs text-muted-foreground">
      <div className="flex justify-center gap-6">
        <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
        <Link to="/community-guidelines" className="hover:text-foreground transition-colors">Community Guidelines</Link>
        <Link to="/delete-account" className="hover:text-foreground transition-colors">Delete Account</Link>
      </div>
      <p className="mt-3">© {new Date().getFullYear()} Vibely. All rights reserved.</p>
    </footer>
  </div>
  );
};

export default PrivacyPolicy;
