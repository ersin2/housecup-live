import { Link, useParams } from 'react-router';
import type { AdminEventDTO } from '@housecup/shared/types';
import { QrCode } from '../../components/ui.tsx';
import { useDocumentTheme, useDocumentTitle } from '../../lib/theme.ts';
import { ErrorNote, useLoad } from './common.tsx';

/** A4 judge card for clipboards: large QR, fallback PIN, three steps. */
export function PrintCard() {
  useDocumentTheme('daylight');
  const { id } = useParams();
  const { data, error } = useLoad<{ event: AdminEventDTO }>(`/events/${id}`);
  const event = data?.event;
  useDocumentTitle(event ? `Judge card: ${event.name}` : 'Judge card');
  if (error) return <div className="p-6"><ErrorNote>{error}</ErrorNote></div>;
  if (!event) return <p className="p-6 text-neutral-600">Loading…</p>;

  const url = `${location.origin}/judge?token=${event.judge_token}`;
  const host = location.host;

  return (
    <div className="min-h-dvh bg-neutral-200 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-6 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <Link to={`/admin/events/${event.id}`} className="font-semibold text-neutral-700">
          ← Back to {event.name}
        </Link>
        <button type="button" onClick={() => print()} className="press h-12 rounded-xl bg-black px-6 font-bold text-white">
          Print card
        </button>
      </div>

      <article className="print-card mx-auto flex min-h-[273mm] w-full max-w-[186mm] flex-col bg-white p-[14mm] text-black shadow-xl">
        <header className="border-b-[3px] border-black pb-5">
          <p className="text-lg font-semibold">Judge card</p>
          <h1 className="wide mt-1 text-[34pt] leading-[1.02] font-black">{event.name}</h1>
        </header>

        <div className="mt-8 flex flex-1 flex-col items-center">
          <QrCode value={url} size={320} className="h-[88mm]! w-[88mm]!" />
          <p className="mt-4 text-center text-lg font-semibold">Scan with your phone camera to open the judge pad</p>
        </div>

        <div className="mt-8 grid grid-cols-[auto_1fr] items-center gap-x-8 gap-y-2 border-y-[3px] border-black py-6">
          <div>
            <div className="text-base font-semibold">No camera? Go to</div>
            <div className="wide text-xl font-black">{host}/judge</div>
          </div>
          <div className="text-right">
            <div className="text-base font-semibold">and enter PIN</div>
            <div className="num wide text-[44pt] leading-none font-black tracking-[0.12em]">{event.judge_pin}</div>
          </div>
        </div>

        <ol className="mt-8 grid grid-cols-3 gap-6 text-[13pt] leading-snug">
          <li>
            <div className="wide text-[20pt] font-black">1</div>
            <strong>Open the pad.</strong> Scan the code above. You stay signed in for the whole day.
          </li>
          <li>
            <div className="wide text-[20pt] font-black">2</div>
            <strong>Tap points.</strong> Use +1, +3, +5, +10 on each team, or tap the box to type any value or penalty.
          </li>
          <li>
            <div className="wide text-[20pt] font-black">3</div>
            <strong>Tap Save points.</strong> A green bar confirms it. Made a mistake? Tap Undo.
          </li>
        </ol>

        <p className="mt-auto pt-8 text-sm text-neutral-600">
          Keep this card private: anyone with the code or PIN can add points. The organiser can issue a new one at any time.
        </p>
      </article>
    </div>
  );
}
