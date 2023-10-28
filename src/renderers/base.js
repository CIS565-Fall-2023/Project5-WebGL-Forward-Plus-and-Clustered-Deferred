import TextureBuffer from './textureBuffer';

export const MAX_LIGHTS_PER_CLUSTER = 100;

export default class BaseRenderer {
  constructor(xSlices, ySlices, zSlices) {
    // Create a texture to store cluster data. Each cluster stores the number of lights followed by the light indices
    this._clusterTexture = new TextureBuffer(xSlices * ySlices * zSlices, MAX_LIGHTS_PER_CLUSTER + 1);
    this._xSlices = xSlices;
    this._ySlices = ySlices;
    this._zSlices = zSlices;
  }

  updateClusters(camera, viewMatrix, scene) {

    // Initialize each cluster's light count to 0
    for (let i = 0; i < this._clusterTexture.buffer.length; i += 4) {
      this._clusterTexture.buffer[i] = 0;
    }

    // Compute the dimensions of each cluster
    const width = 2 * Math.tan(camera.fov / 2);
    const height = width / camera.aspect;
    const depth = camera.far - camera.near;
    const clusterWidth = width / this._xSlices;
    const clusterHeight = height / this._ySlices;
    const clusterDepth = depth / this._zSlices;

    // Iterate through each light in the scene
    for (let i = 0; i < scene.lights.length; i++) {
      const light = scene.lights[i];
      const lightPos = vec4.fromValues(light.position[0], light.position[1], light.position[2], 1.0);
      vec4.transformMat4(lightPos, lightPos, viewMatrix);
      const lightRadius = light.radius;

      // Compute the range of clusters that the light overlaps
      const xStart = Math.max(Math.floor((lightPos[0] - lightRadius + width / 2) / clusterWidth), 0);
      const xEnd = Math.min(Math.floor((lightPos[0] + lightRadius + width / 2) / clusterWidth), this._xSlices - 1);
      const yStart = Math.max(Math.floor((lightPos[1] - lightRadius + height / 2) / clusterHeight), 0);
      const yEnd = Math.min(Math.floor((lightPos[1] + lightRadius + height / 2) / clusterHeight), this._ySlices - 1);
      const zStart = Math.max(Math.floor((lightPos[2] - lightRadius - camera.near) / clusterDepth), 0);
      const zEnd = Math.min(Math.floor((lightPos[2] + lightRadius - camera.near) / clusterDepth), this._zSlices - 1);

      // Update the cluster texture with the light indices
      for (let z = zStart; z <= zEnd; ++z) {
        for (let y = yStart; y <= yEnd; ++y) {
          for (let x = xStart; x <= xEnd; ++x) {
            const clusterIndex = x + y * this._xSlices + z * this._xSlices * this._ySlices;
            const numLightsInCluster = this._clusterTexture.buffer[this._clusterTexture.bufferIndex(clusterIndex, 0)];

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

    // Update the cluster texture
    this._clusterTexture.update();
  }

}