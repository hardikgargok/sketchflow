import "./ExcalidrawLogo.scss";

type LogoSize = "xs" | "small" | "normal" | "large" | "custom" | "mobile";

interface LogoProps {
  size?: LogoSize;
  withText?: boolean;
  style?: React.CSSProperties;
  isNotLink?: boolean;
}

export const ExcalidrawLogo = ({
  style,
  size = "small",
  withText,
}: LogoProps) => {
  return (
    <div className={`ExcalidrawLogo is-${size}`} style={style}>
      <img
        className="ExcalidrawLogo-icon"
        src="/android-chrome-192x192.png"
        alt="SketchFlow"
      />
      {withText && <span className="ExcalidrawLogo-text">SketchFlow</span>}
    </div>
  );
};
