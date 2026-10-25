import React from 'react';
import { Composition } from 'remotion';
import { FPS } from './components/Film';
import { windTunnelFilm } from './windtunnel/WindTunnelFilm';

export const Root: React.FC = () => (
  <>
    <Composition
      id="WindTunnelLandscape"
      component={windTunnelFilm.Component}
      durationInFrames={windTunnelFilm.durationInFrames}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={windTunnelFilm.defaultProps}
      calculateMetadata={windTunnelFilm.calculateMetadata}
    />
  </>
);
