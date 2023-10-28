export default function (params) {
  return `
  #version 100
  precision highp float;

  uniform sampler2D u_colmap;
  uniform sampler2D u_normap;
  uniform sampler2D u_lightbuffer;

  uniform sampler2D u_clusterbuffer;
  uniform float u_clusterWidth;
  uniform float u_clusterHeight;
  uniform float u_nearClip;
  uniform float u_farClip;
  uniform int u_xSlices;
  uniform int u_ySlices;
  uniform int u_zSlices;
  uniform mat4 u_viewMatrix;

  varying vec3 v_position;
  varying vec3 v_normal;
  varying vec2 v_uv;

  vec3 applyNormalMap(vec3 geomnor, vec3 normap) {
    normap = normap * 2.0 - 1.0;
    vec3 up = normalize(vec3(0.001, 1, 0.001));
    vec3 surftan = normalize(cross(geomnor, up));
    vec3 surfbinor = cross(geomnor, surftan);
    return normap.y * surftan + normap.x * surfbinor + normap.z * geomnor;
  }

  struct Light {
    vec3 position;
    float radius;
    vec3 color;
  };

  float ExtractFloat(sampler2D texture, int textureWidth, int textureHeight, int index, int component) {
    float u = float(index + 1) / float(textureWidth + 1);
    int pixel = component / 4;
    float v = float(pixel + 1) / float(textureHeight + 1);
    vec4 texel = texture2D(texture, vec2(u, v));
    int pixelComponent = component - pixel * 4;
    if (pixelComponent == 0) {
      return texel[0];
    } else if (pixelComponent == 1) {
      return texel[1];
    } else if (pixelComponent == 2) {
      return texel[2];
    } else if (pixelComponent == 3) {
      return texel[3];
    }
  }

  Light UnpackLight(int index) {
    Light light;
    float u = float(index + 1) / float(${params.numLights + 1});
    vec4 v1 = texture2D(u_lightbuffer, vec2(u, 0.3));
    vec4 v2 = texture2D(u_lightbuffer, vec2(u, 0.6));
    light.position = v1.xyz;
    light.radius = ExtractFloat(u_lightbuffer, ${params.numLights}, 2, index, 3);
    light.color = v2.rgb;
    return light;
  }

  // Cubic approximation of gaussian curve so we falloff to exactly 0 at the light radius
  float cubicGaussian(float h) {
    if (h < 1.0) {
      return 0.25 * pow(2.0 - h, 3.0) - pow(1.0 - h, 3.0);
    } else if (h < 2.0) {
      return 0.25 * pow(2.0 - h, 3.0);
    } else {
      return 0.0;
    }
  }

  void main() {
    vec3 albedo = texture2D(u_colmap, v_uv).rgb;
    vec3 normap = texture2D(u_normap, v_uv).xyz;
    vec3 normal = applyNormalMap(v_normal, normap);

    // Transform the fragment position to camera space
    vec4 fragPosCameraSpace = u_viewMatrix * vec4(v_position, 1.0);

    // Determine the cluster for a fragment using its position in camera space
    float depth = (length(-fragPosCameraSpace.xyz) - u_nearClip) / (u_farClip - u_nearClip);
    int clusterX = int((fragPosCameraSpace.x + u_clusterWidth / 2.0) / u_clusterWidth);
    int clusterY = int((fragPosCameraSpace.y + u_clusterHeight / 2.0) / u_clusterHeight);
    int clusterZ = int(depth * float(u_zSlices));
    int clusterIdx = clusterX + clusterY * u_xSlices + clusterZ * u_xSlices * u_ySlices;
    float clusterCount = ExtractFloat(u_clusterbuffer, int(u_xSlices * u_ySlices * u_zSlices), int(${params.maxLightsPerCluster} + 1), clusterIdx, 0);

    int texture_width = int(u_xSlices * u_ySlices * u_zSlices);
    int texture_height = int(ceil((float(${params.maxLightsPerCluster}) + 1.0) / 4.0));

    if (clusterIdx > texture_width) {
      gl_FragColor = vec4(vec3(1, 0, 0), 1.0);
      return;
    }

    int num_lights = int(ExtractFloat(u_clusterbuffer, texture_width, texture_height, idx, 0));
    
    // Read in the lights in that cluster from the populated data
    vec3 fragColor = vec3(0.0);
    for (int light = 0; light < ${params.maxLightsPerCluster}; ++light) {
      if (light >= num_lights) {
        break;
      }
      else {
        int light_idx = int(ExtractFloat(u_clusterbuffer, texture_width, texture_height, idx, light + 1));
        Light this_light = UnpackLight(light_idx);

        float lightDistance = distance(this_light.position, v_position);
        vec3 L = (this_light.position - v_position) / lightDistance;

        float lightIntensity = cubicGaussian(2.0 * lightDistance / this_light.radius);
        float lambertTerm = max(dot(L, normal), 0.0);

        fragColor += albedo * lambertTerm * this_light.color * vec3(lightIntensity);
      }
    }

    const vec3 ambientLight = vec3(0.025);
    fragColor += albedo * ambientLight;

    gl_FragColor = vec4(fragColor, 1.0);
  }
  `;
}
