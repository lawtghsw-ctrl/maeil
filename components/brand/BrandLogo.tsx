import Image from "next/image";
import logo from "./lawpower-logo.jpg";

export function BrandLogo({ width = 44, priority = false }: { width?: number; priority?: boolean }) {
  return (
    <Image
      src={logo}
      alt="로파워 로고"
      width={width}
      height={Math.round(width * logo.height / logo.width)}
      sizes={`${width}px`}
      priority={priority}
      className="block h-auto shrink-0 object-contain"
    />
  );
}
