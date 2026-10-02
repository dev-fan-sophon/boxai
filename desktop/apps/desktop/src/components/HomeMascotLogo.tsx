import { BrandLogo } from "./BrandLogo";

export function HomeMascotLogo() {
  return (
    <span
      className="home-mascot-logo"
      data-testid="home-mascot-logo"
      aria-hidden="true"
    >
      <BrandLogo size={100} />
    </span>
  );
}
