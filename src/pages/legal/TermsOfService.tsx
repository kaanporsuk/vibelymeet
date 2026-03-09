import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const TermsOfService = () => {
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
        <h1 className="text-xl font-display font-bold text-foreground">Terms of Service</h1>
      </div>
    </header>

    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-muted-foreground mb-10">Effective date: March 2026</p>

      <div className="space-y-8 text-sm leading-relaxed text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-3">
        <section>
          <h2>1. Acceptance</h2>
          <p>Using Vibely means you accept these Terms.</p>
        </section>

        <section>
          <h2>2. Eligibility</h2>
          <p>You must be 18+. One account per person. No bots or automated accounts.</p>
        </section>

        <section>
          <h2>3. Your Account</h2>
          <p>
            Provide accurate information. You are responsible for your account security. You can delete your account anytime via Settings → Delete My Account or at{" "}
            <Link to="/delete-account" className="text-neon-violet hover:underline">vibelymeet.com/delete-account</Link>.
          </p>
        </section>

        <section>
          <h2>4. Code of Conduct</h2>
          <p className="mb-2">You must not:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Impersonate others or misrepresent your identity</li>
            <li>Harass, threaten, or harm any user</li>
            <li>Send unsolicited explicit content</li>
            <li>Record other users without consent</li>
            <li>Use the Service for spam or commercial solicitation</li>
            <li>Create multiple accounts after suspension</li>
          </ul>
        </section>

        <section>
          <h2>5. User Content</h2>
          <p>
            You own your content. You grant Vibely a licence to display it within the Service. You must not upload explicit, violent, or infringing content. We may remove violating content without notice.
          </p>
        </section>

        <section>
          <h2>6. Payments</h2>
          <p>
            Prices in EUR. Event tickets non-refundable after event starts (refundable 24h before). Credits non-refundable. Subscriptions cancel at period end. EU consumers have a 14-day right of withdrawal.
          </p>
        </section>

        <section>
          <h2>7. Premium & Credits</h2>
          <p>
            Premium: €14.99/month or €149.90/year, auto-renewing. Credits: virtual currency, no cash value, non-transferable.
          </p>
        </section>

        <section>
          <h2>8. Safety</h2>
          <p>
            Meet new people in public places. Report abuse via the app or safety@vibelymeet.com. For emergencies contact local emergency services.
          </p>
        </section>

        <section>
          <h2>9. Termination</h2>
          <p>We may suspend or ban accounts that violate these Terms. You may delete your account at any time.</p>
        </section>

        <section>
          <h2>10. Limitation of Liability</h2>
          <p>
            Service provided as-is. We are not liable for user conduct. Total liability capped at amounts paid in prior 12 months. EU consumer rights not affected.
          </p>
        </section>

        <section>
          <h2>11. Governing Law</h2>
          <p>Polish law. Kraków courts. EU ODR platform available.</p>
        </section>

        <section>
          <h2>12. Contact</h2>
          <p>legal@vibelymeet.com</p>
        </section>
      </div>
    </main>

    <footer className="border-t border-border/40 px-6 py-6 text-center text-xs text-muted-foreground">
      <div className="flex justify-center gap-6">
        <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
        <Link to="/delete-account" className="hover:text-foreground transition-colors">Delete Account</Link>
      </div>
      <p className="mt-3">© {new Date().getFullYear()} Vibely. All rights reserved.</p>
    </footer>
  </div>
);

export default TermsOfService;
