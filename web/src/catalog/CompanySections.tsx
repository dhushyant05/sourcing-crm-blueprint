import { ClipboardList, Factory, FileText, Mail, MapPin, MessageCircle, Phone, Ship } from 'lucide-react';
import { EnquireForm } from './EnquireForm';

const PHONE = '+91 72995 41489', TEL = '+917299541489', EMAIL = 'fortuneengineering05@gmail.com';
const WA = 'https://wa.me/917299541489';

export function CompanySections() {
  return (
    <div className="bg-white">
      <section id="how" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-ink-800 sm:text-3xl">How Source Easy works</h2>
        <p className="mt-2 max-w-2xl text-ink-500">Tell us what you need. We source it, quote it, and ship it — with a single team in India and China.</p>
        <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [ClipboardList, 'Share your requirement'],
            [Factory, 'We source and sample'],
            [FileText, 'You review the quote'],
            [Ship, 'We handle the shipment'],
          ].map(([I, title], i) => (
            <li key={i} className="rounded-2xl border border-ink-100 bg-white p-6 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-white"><I size={20} /></span>
              <h3 className="mt-5 font-semibold text-ink-800">{title as string}</h3>
            </li>
          ))}
        </ol>
      </section>
      <section id="services" className="border-y border-ink-100 bg-ink-50/60">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-800 sm:text-3xl">Services</h2>
          <p className="mt-2 max-w-2xl text-ink-500">Product sourcing, quality checks, customer quotes, and door-to-door shipping — all in one place.</p>
        </div>
      </section>
      <section id="contact" className="mx-auto max-w-7xl scroll-mt-56 px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-ink-800 sm:text-3xl">Contact</h2>
        <div className="mt-6 flex flex-col gap-3 text-sm text-ink-700">
          <a href={`tel:${TEL}`} className="inline-flex items-center gap-2 hover:text-brand-700"><Phone size={16} />{PHONE}</a>
          <a href={`mailto:${EMAIL}`} className="inline-flex items-center gap-2 hover:text-brand-700"><Mail size={16} />{EMAIL}</a>
          <a href={WA} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-brand-700"><MessageCircle size={16} />WhatsApp {PHONE}</a>
          <p className="inline-flex items-center gap-2"><MapPin size={16} />India and China offices</p>
        </div>
        <div id="quote" className="mt-10 scroll-mt-56 rounded-2xl border border-ink-100 bg-white p-5 shadow-soft sm:p-8">
          <h3 className="text-xl font-semibold tracking-tight text-ink-800">Request a quote</h3>
          <p className="mt-1 text-sm text-ink-500">Tell us what you need. We’ll come back with a Source Easy quote. This is not a checkout.</p>
          <div className="mt-5"><EnquireForm /></div>
        </div>
      </section>
    </div>
  );
}
