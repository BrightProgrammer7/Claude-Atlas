import { quizQrSvg } from "@/lib/quiz-link";

// The SVG is produced while the page is prerendered, from a fixed URL, with no external service.
// It is shown as an image data URI rather than injected markup, so no HTML is ever inserted.
export default async function QuizQr({ className }: { className?: string }) {
  const svgMarkup = await quizQrSvg();
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI needs no optimisation
    <img
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`}
      alt="QR code that opens the Claude Atlas quiz"
      className={className}
    />
  );
}
