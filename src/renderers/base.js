import TextureBuffer from './textureBuffer';
import { mat4, vec4, vec3 } from 'gl-matrix';

// Constants
const HALF = 0.5;
const PI_OVER_180 = Math.PI / 180.0;
export const MAX_LIGHTS_PER_CLUSTER = 5000;

export default class BaseRenderer {
  constructor(xSlices, ySlices, zSlices) {
    // Ensure valid slice dimensions are provided
    if (!xSlices || !ySlices || !zSlices) {
      throw new Error('Invalid slice dimensions provided to BaseRenderer constructor.');
    }
    // Create a new TextureBuffer to store cluster data
    this._clusterTexture = new TextureBuffer(xSlices * ySlices * zSlices, MAX_LIGHTS_PER_CLUSTER + 1);
    // Store slice dimensions
    this._xSlices = xSlices;
    this._ySlices = ySlices;
    this._zSlices = zSlices;
    // Precompute product of x and y slice dimensions for efficiency
    this._xySliceProduct = this._xSlices * this._ySlices;
  }

  /**
   * Resets the cluster data for a new frame.
   */
  resetClusters() {
    // Iterate through each cluster and reset light count to 0
    for (let z = 0; z < this._zSlices; ++z) {
      for (let y = 0; y < this._ySlices; ++y) {
        for (let x = 0; x < this._xSlices; ++x) {
          const i = x + y * this._xSlices + z * this._xySliceProduct;
          this._clusterTexture.buffer[this._clusterTexture.bufferIndex(i, 0)] = 0;
        }
      }
    }
  }

  /**
   * Updates the cluster light indices based on the current scene lights.
   * @param {Camera} camera - The camera object.
   * @param {mat4} viewMatrix - The view matrix.
   * @param {Scene} scene - The scene object.
   */
  updateClusterLights(camera, viewMatrix, scene) {
    // Compute half height of the frustum
    const frustrumHalfHeight = Math.tan(camera.fov * HALF * PI_OVER_180);
    const zStride = (camera.far - camera.near) / this._zSlices;

    // Reusable vec3 objects to avoid creating new objects in the loop
    const lightMin = vec3.create();
    const lightMax = vec3.create();
    const sphereRadius = vec3.create();

    // Iterate through each light in the scene
    for (let i = 0; i < scene.lights.length; i++) {
      const light = scene.lights[i];
      // Convert light position to view space
      let lightPos = vec4.fromValues(light.position[0], light.position[1], light.position[2], 1.0);
      vec4.transformMat4(lightPos, lightPos, viewMatrix);
      // Flip the sign of z as camera is looking down -z
      lightPos[2] *= -1.0;

      // Compute bounding sphere radius
      vec3.set(sphereRadius, light.radius, light.radius, light.radius);
      // Compute min and max bounds of the light's bounding box
      vec3.subtract(lightMin, vec3.fromValues(lightPos[0], lightPos[1], lightPos[2]), sphereRadius);
      vec3.add(lightMax, vec3.fromValues(lightPos[0], lightPos[1], lightPos[2]), sphereRadius);

      // Compute half dimensions of the frustum at the min and max z bounds
      const halfHeightAtZMin = frustrumHalfHeight * lightMin[2];
      const halfHeightAtZMax = frustrumHalfHeight * lightMax[2];
      const halfWidthAtZMin = halfHeightAtZMin * camera.aspect;
      const halfWidthAtZMax = halfHeightAtZMax * camera.aspect;

      // Compute the start and end indices of the clusters affected by the light using the logarithmic formula
      let xStart = (lightMin[0] + halfWidthAtZMin) * this._xSlices / (2.0 * halfWidthAtZMin);
      let xEnd = (lightMax[0] + halfWidthAtZMax) * this._xSlices / (2.0 * halfWidthAtZMax);
      let yStart = (lightMin[1] + halfHeightAtZMin) * this._ySlices / (2.0 * halfHeightAtZMin);
      let yEnd = (lightMax[1] + halfHeightAtZMax) * this._ySlices / (2.0 * halfHeightAtZMax);
      let zStart = (lightMin[2] - camera.near) / zStride;
      let zEnd = (lightMax[2] - camera.near) / zStride;

      // Cull the light if it is outside the frustum
      if (xStart > this._xSlices || xEnd < 0 || yStart > this._ySlices || yEnd < 0 || zStart > this._zSlices || zEnd < 0) {
        continue;
      }

      // Clamp the indices to the bounds of the frustum
      xStart = Math.floor(Math.min(Math.max(xStart, 0.0), this._xSlices - 1));
      xEnd = Math.floor(Math.min(Math.max(xEnd, 0.0), this._xSlices - 1));
      yStart = Math.floor(Math.min(Math.max(yStart, 0.0), this._ySlices - 1));
      yEnd = Math.floor(Math.min(Math.max(yEnd, 0.0), this._ySlices - 1));
      zStart = Math.floor(Math.min(Math.max(zStart, 0.0), this._zSlices - 1));
      zEnd = Math.floor(Math.min(Math.max(zEnd, 0.0), this._zSlices - 1));

      // Update the cluster texture with the light indices
      for (let z = zStart; z <= zEnd; ++z) {
        for (let y = yStart; y <= yEnd; ++y) {
          for (let x = xStart; x <= xEnd; ++x) {
            const clusterIndex = x + y * this._xSlices + z * this._xySliceProduct;
            const numLightsInCluster = this._clusterTexture.buffer[this._clusterTexture.bufferIndex(clusterIndex, 0)];

            // Update the light index in the cluster texture if there's room
            if (numLightsInCluster < MAX_LIGHTS_PER_CLUSTER) {
              const texelIndex = this._clusterTexture.bufferIndex(clusterIndex, Math.floor((numLightsInCluster + 1) / 4) + 1);
              const texelComponent = (numLightsInCluster + 1) % 4;
              this._clusterTexture.buffer[texelIndex + texelComponent] = i;
              this._clusterTexture.buffer[this._clusterTexture.bufferIndex(clusterIndex, 0)]++;
            }
          }
        }
      }
    }
  }

  updateClusters(camera, viewMatrix, scene) {
    // Reset cluster data for the new frame
    this.resetClusters();
    // Update cluster light indices based on the current scene lights
    this.updateClusterLights(camera, viewMatrix, scene);
    // Update the cluster texture
    this._clusterTexture.update();
  }
}
