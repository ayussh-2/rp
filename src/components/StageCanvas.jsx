export function StageCanvas({ canvasRef }) {
  return (
    <>
      <div className="stage">
        <canvas ref={canvasRef} id="view" />
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--reg-a)' }}></i>Coarse grains (layer bands)
        </span>
        <span>
          <i style={{ background: 'var(--fines)' }}></i>Fines
        </span>
        <span>
          <i style={{ background: 'var(--ejecta)' }}></i>Airborne fines and their paths
        </span>
        <span>
          <i style={{ background: 'var(--wheel)' }}></i>Rim and grousers (contact)
        </span>
        <span>
          <i style={{ background: 'var(--wheel-2)' }}></i>Spokes and hub
        </span>
        <span>
          <i className="dash"></i>Settled surface at release
        </span>
      </div>
    </>
  );
}
