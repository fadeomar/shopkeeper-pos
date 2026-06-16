/**
 * Icons — a curated re-export of lucide-react icons used across the app.
 *
 * Why a barrel file:
 *   1. Discoverability — one place to see "what icons does this app use?"
 *      and pick consistently rather than letting every dev free-import.
 *   2. Bundle clarity — lucide-react is tree-shaken, but a barrel makes
 *      it obvious which icons we ship. Offline-first: every icon listed
 *      here is bundled at build time, no runtime fetch.
 *   3. Aliases — we rename a few to match domain language ("Scan" reads
 *      better at call sites than "ScanLine").
 *
 * Rule of thumb when adding: prefer outline icons (default), 1.5–2.0
 * stroke. Don't add an icon if a text symbol does the job equally well
 * — '?' help button, '→' next arrows etc. are fine to keep.
 */
export {
  // Navigation
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  Package,
  Boxes,
  BarChart3,
  Users,
  Truck,
  Clock,
  Banknote,
  Wallet,
  History,
  Settings,
  // Actions
  Plus,
  Play,
  Minus,
  X,
  Check,
  Trash2,
  Pencil,
  Search,
  Filter,
  Download,
  Upload,
  Printer,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  // Status / state
  CircleCheck,
  CircleAlert,
  TriangleAlert,
  Info,
  Loader2,
  WifiOff,
  Wifi,
  CloudOff,
  Cloud,
  CloudUpload,
  // Domain — POS / inventory
  ScanLine as Scan,
  Barcode,
  CreditCard,
  Coins,
  Tag,
  PackageOpen,
  PackageX,
  ShieldCheck,
  Lock,
  LogOut,
  LogIn,
  UserPlus,
  // Misc
  Ban,
  MoreHorizontal,
  MoreVertical,
  Eye,
  EyeOff,
  HelpCircle,
  CalendarDays,
  Phone,
  Mail,
  MapPin,
  Store,
} from "lucide-react";
