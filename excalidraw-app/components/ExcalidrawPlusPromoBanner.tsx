export const ExcalidrawPlusPromoBanner = ({
  isSignedIn: _isSignedIn,
}: {
  isSignedIn: boolean;
}) => {
  return (
    <a
      href="#sketchflow-plus"
      onClick={(event) => event.preventDefault()}
      target="_blank"
      rel="noopener"
      className="plus-banner"
    >
      SketchFlow +
    </a>
  );
};
