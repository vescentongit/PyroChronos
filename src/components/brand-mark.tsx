import Image from "next/image";

export function BrandMark({ size = 36 }: { size?: number }) {
  return <Image src="/brand-mark-light.png" alt="" width={size} height={size} className="brand-mark" />;
}
