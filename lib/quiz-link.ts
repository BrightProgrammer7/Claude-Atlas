import QRCode from "qrcode";

// Where the QR code points. A fixed production URL, because the QR is generated at build time
// and printed or projected: it must not depend on the host of whoever happens to render it.
export const QUIZ_URL = "https://claudeatlas.vercel.app/quiz";

// Black on white with a quiet zone, whatever the page theme: scanners need the contrast.
export async function quizQrSvg(): Promise<string> {
  return QRCode.toString(QUIZ_URL, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#141413", light: "#ffffff" },
  });
}
