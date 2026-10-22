import "./globals.css";
import "leaflet/dist/leaflet.css";
import { ToastProvider } from "./components/ui/ToastProvider";

export const metadata = {
  title: "Work Ledger | Attendance",
  description: "Attendance and payroll operations",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
