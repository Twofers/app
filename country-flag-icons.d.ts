// `country-flag-icons` ships no type declarations for its per-country string
// modules. We import only the three flags we use, so declare those specifiers
// explicitly (exact ambient declarations avoid bundling all 270 flags).
declare module "country-flag-icons/string/3x2/US" {
  const svg: string;
  export default svg;
}
declare module "country-flag-icons/string/3x2/MX" {
  const svg: string;
  export default svg;
}
declare module "country-flag-icons/string/3x2/KR" {
  const svg: string;
  export default svg;
}
