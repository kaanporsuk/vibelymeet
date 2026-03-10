import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const CommunityGuidelines = () => {
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
          <h1 className="text-xl font-display font-bold text-foreground">Community Guidelines</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold mb-2">Community Guidelines</h1>
        <p className="text-muted-foreground mb-10">Effective date: March 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-3">
          <section>
            <h2>Our Promise</h2>
            <p>
              Vibely is built on a simple belief: meaningful connections happen when people feel safe, respected, and free to be themselves. These guidelines exist to protect that environment for everyone. By using Vibely, you agree to uphold them.
            </p>
          </section>

          <section>
            <h2>1. Be Yourself — Authentically</h2>
            <p className="mb-2">Vibely is a space for real people and real connections.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Use your real name, real photos, and accurate information</li>
              <li>Do not impersonate any person, brand, or organisation</li>
              <li>Do not create fake or duplicate accounts</li>
              <li>Do not use bots, scripts, or automated tools to interact with others</li>
              <li>One account per person — suspended users may not create new accounts</li>
            </ul>
          </section>

          <section>
            <h2>2. Respect Everyone</h2>
            <p className="mb-2">Every person on Vibely deserves dignity and respect.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Do not harass, bully, threaten, or intimidate any user</li>
              <li>Do not send unsolicited explicit, sexual, or graphic content</li>
              <li>Do not make discriminatory remarks based on race, ethnicity, gender, sexual orientation, religion, disability, or age</li>
              <li>Do not pressure, coerce, or manipulate others into interactions they have not consented to</li>
              <li>Respect when someone is not interested — do not continue contact after being blocked or ignored</li>
            </ul>
          </section>

          <section>
            <h2>3. No Explicit or Adult Content</h2>
            <p className="mb-2">Vibely is not an adult content platform. This is absolute.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>No nudity or sexually explicit content in photos, videos, bios, or chat — ever</li>
              <li>No suggestive content that mimics or implies explicit material</li>
              <li>No solicitation of sexual services, paid or unpaid</li>
              <li>No sharing or requesting intimate images of any person</li>
              <li>Violations result in immediate, permanent account removal</li>
            </ul>
          </section>

          <section>
            <h2>4. Consent-First, Always</h2>
            <p className="mb-2">Consent is built into how Vibely works — and we expect users to extend that principle to all interactions.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Do not record, screenshot, or capture any part of a video date without explicit consent</li>
              <li>Do not share another user's photos, videos, or personal information outside the platform</li>
              <li>Respect our Ready Gate system — do not attempt to circumvent or pressure others during it</li>
              <li>Consent can be withdrawn at any time; respect that immediately</li>
            </ul>
          </section>

          <section>
            <h2>5. Keep It Safe</h2>
            <p className="mb-2">Your safety and the safety of others is our highest priority.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Do not share personal contact information (phone, address, social media) too early — use in-app chat</li>
              <li>For first in-person meetings, choose public places</li>
              <li>Do not use Vibely to facilitate fraud, scams, or financial solicitation</li>
              <li>Do not share links to external websites in unsolicited messages</li>
              <li>Report any user who makes you feel unsafe using the in-app report button or emailing <a href="mailto:safety@vibelymeet.com" className="text-neon-violet hover:underline">safety@vibelymeet.com</a></li>
            </ul>
          </section>

          <section>
            <h2>6. Protect Minors</h2>
            <p>
              Vibely is strictly for users aged 18 and over. We enforce this at registration through phone and photo verification. Any account found to belong to a minor, or any adult engaging in inappropriate contact with a minor, will be permanently banned and reported to the relevant authorities without exception. Report underage accounts immediately to <a href="mailto:safety@vibelymeet.com" className="text-neon-violet hover:underline">safety@vibelymeet.com</a>.
            </p>
          </section>

          <section>
            <h2>7. No Spam or Commercial Activity</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Do not use Vibely to promote products, services, or businesses</li>
              <li>Do not send repetitive, unsolicited, or bulk messages</li>
              <li>Do not solicit money, gifts, or financial favours from other users</li>
              <li>Do not use Vibely for recruitment, multi-level marketing, or affiliate promotion</li>
            </ul>
          </section>

          <section>
            <h2>8. Consequences</h2>
            <p className="mb-2">We take enforcement seriously. Depending on severity, violations may result in:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>A warning and content removal</li>
              <li>Temporary suspension</li>
              <li>Permanent account ban</li>
              <li>Reporting to law enforcement where legally required</li>
            </ul>
            <p className="mt-2">We operate a zero-tolerance policy for explicit content, impersonation, minor safety violations, and threats of violence.</p>
          </section>

          <section>
            <h2>9. Reporting</h2>
            <p>
              If you encounter a violation, please report it immediately using the flag/report button on any profile, message, or video, or email us at <a href="mailto:safety@vibelymeet.com" className="text-neon-violet hover:underline">safety@vibelymeet.com</a>. We review all reports and take action within 24 hours for urgent safety issues.
            </p>
          </section>

          <section>
            <h2>10. Contact</h2>
            <p><a href="mailto:safety@vibelymeet.com" className="text-neon-violet hover:underline">safety@vibelymeet.com</a></p>
            <p><a href="mailto:legal@vibelymeet.com" className="text-neon-violet hover:underline">legal@vibelymeet.com</a></p>
          </section>
        </div>
      </main>

      <footer className="border-t border-border/40 px-6 py-6 text-center text-xs text-muted-foreground">
        <div className="flex justify-center gap-6">
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link to="/delete-account" className="hover:text-foreground transition-colors">Delete Account</Link>
        </div>
        <p className="mt-3">© {new Date().getFullYear()} Vibely. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default CommunityGuidelines;
