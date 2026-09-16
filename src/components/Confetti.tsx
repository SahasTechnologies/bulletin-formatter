import { useEffect, useMemo, useState } from 'react';

/**
 * The celebration at the end of a walkthrough.
 *
 * A plain DOM effect rather than a canvas or a dependency: the guide needed one
 * "you are finished" moment, and 140 absolutely-positioned pieces animated by
 * one keyframe rule cost nothing and print nothing (`no-print`, and the overlay
 * unmounts itself).
 *
 * Pieces are generated once per mount and never re-randomised, so React does
 * not reshuffle the fall when the parent re-renders.
 */

const COLOURS = ['#e8710a', '#f9ab00', '#e37400', '#b06000', '#3c4043', '#ffd699', '#c5221f'];

interface Piece {
  left: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  size: number;
  ratio: number;
  colour: string;
  round: boolean;
}

function makePieces(count: number): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      left: Math.random() * 100,
      delay: Math.random() * 1.6,
      duration: 2.6 + Math.random() * 2.2,
      drift: (Math.random() - 0.5) * 220,
      spin: 360 + Math.random() * 900,
      size: 6 + Math.random() * 8,
      ratio: 0.5 + Math.random() * 1.4,
      colour: COLOURS[i % COLOURS.length],
      round: i % 3 === 0,
    });
  }
  return out;
}

export default function Confetti({
  /** How long the whole shower lasts, in ms. */
  duration = 5200,
  onDone,
}: {
  duration?: number;
  onDone?: () => void;
}) {
  const pieces = useMemo(() => makePieces(140), []);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setGone(true);
      onDone?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDone]);

  if (gone) return null;

  return (
    <div
      className="no-print pointer-events-none fixed inset-0 z-[100] overflow-hidden"
      aria-hidden="true"
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece absolute top-0"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * p.ratio,
            background: p.colour,
            borderRadius: p.round ? '9999px' : '2px',
            // The flight path lives in the keyframes; the numbers are per piece.
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            ['--confetti-drift' as string]: `${p.drift}px`,
            ['--confetti-spin' as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
