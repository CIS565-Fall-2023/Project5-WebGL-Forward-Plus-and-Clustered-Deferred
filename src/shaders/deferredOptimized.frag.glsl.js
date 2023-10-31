export default function (params) {
  return `
  #version 100
  precision highp float;
  
  uniform sampler2D u_gbuffers[${params.numGBuffers}];
  uniform sampler2D u_lightbuffer;
  uniform sampler2D u_clusterbuffer;

  uniform mat4 u_viewMatrix;
  uniform float u_xSlices;
  uniform float u_ySlices;
  uniform float u_zSlices;
  uniform float u_fov;
  uniform float u_near;
  uniform float u_far;
  uniform float u_cameraAspect;

  const float maxShininess = 1000.0;
  const float minShininess = 100.0;

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
    vec4 v1 = texture2D(u_lightbuffer, vec2(u, 0.0));
    vec4 v2 = texture2D(u_lightbuffer, vec2(u, 0.5));
    light.position = v1.xyz;

    // LOOK: This extracts the 4th float (radius) of the (index)th light in the buffer
    // Note that this is just an example implementation to extract one float.
    // There are more efficient ways if you need adjacent values
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

  float rand(vec2 co)
  {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // Decoding
  vec3 DecodeNormal(vec2 f) {
    f = f * 2.0 - 1.0;
    vec3 n;
    n.z = 1.0 - abs(f.x) - abs(f.y);
    n.xy = n.z >= 0.0 ? f.xy : ((1.0 - abs(f.yx)) * sign(f.xy));
    return normalize(n);
  }

  void main() {
    vec4 gb0 = texture2D(u_gbuffers[0], v_uv);
    vec4 gb1 = texture2D(u_gbuffers[1], v_uv);

    vec3 worldPos = gb0.xyz;
    vec3 normal = DecodeNormal(vec2(gb0.w, gb1.w));
    vec3 albedo = gb1.rgb;

    vec4 viewPos = u_viewMatrix * vec4(worldPos, 1.0);
    viewPos.z = -viewPos.z;

    // Determine the cluster for a fragment using its position in camera space
    float yFov = tan(u_fov * 0.5 * 3.14159 / 180.0);
    float xFov = yFov * u_cameraAspect;

    float xSliceHalfWidth = xFov * viewPos.z;
    float ySliceHalfWidth = yFov * viewPos.z;

    // Compute the cluster indices for the fragment
    int xCluster = int((viewPos.x + xSliceHalfWidth) * float(u_xSlices) / (2.0 * xSliceHalfWidth) / float(u_xSlices));
    int yCluster = int((viewPos.y + ySliceHalfWidth) * float(u_ySlices) / (2.0 * ySliceHalfWidth) / float(u_ySlices));
    // int zCluster = int(log(viewPos.z / u_near) / log(10.0) * float(u_zSlices) / float(u_zSlices));
    int zCluster = int(u_zSlices * viewPos.z / (u_far - u_near));

    int texture_width = int(u_xSlices * u_ySlices * u_zSlices);
    int texture_height = int(ceil((float(${params.maxLightsPerCluster}) + 1.0) / 4.0));

    int clusterIdx = xCluster + yCluster * int(u_xSlices) + zCluster * int(u_xSlices) * int(u_ySlices);

    if (clusterIdx > texture_width) {
      gl_FragColor = vec4(vec3(1, 0, 0), 1.0);
      return;
    }

    int num_lights = int(ExtractFloat(u_clusterbuffer, texture_width, texture_height, clusterIdx, 0));
    
    vec3 fragColor = vec3(0.0);
    vec3 viewDir = normalize(-viewPos.xyz);  // Camera position is at (0,0,0) in view space
    // generate random shininess
    float shininess = rand(worldPos.xy) * (maxShininess - minShininess) + minShininess;
    float specularTerm = 0.0;

    // Read in the lights in that cluster from the populated data
    // Loop over lights in cluster
    for (int light = 0; light < ${params.maxLightsPerCluster}; ++light) {
      if (light >= num_lights) {
        break;
      }
      else {
        int light_idx = int(ExtractFloat(u_clusterbuffer, texture_width, texture_height, clusterIdx, light + 1));
        Light this_light = UnpackLight(light_idx);

        float lightDistance = distance(this_light.position, worldPos.xyz);
        vec3 L = normalize(this_light.position - worldPos.xyz);
        float lightIntensity = cubicGaussian(2.0 * lightDistance / this_light.radius);
        float lambertTerm = max(dot(L, normal), 0.0);

        vec3 H = normalize(L + viewDir);
        specularTerm = pow(max(dot(normal, H), 0.0), shininess);

        fragColor += (albedo * lambertTerm + vec3(specularTerm)) * this_light.color * vec3(lightIntensity);
      }
    }

    // Extract the bright parts of the image
    float brightness = dot(fragColor, vec3(0.2126, 0.7152, 0.0722));  // Luminance
    vec3 brightColor = max(fragColor - 0.8, 0.0);
    fragColor = fragColor.rgb + brightColor;

    const vec3 ambientLight = vec3(0.2);
    fragColor += albedo * ambientLight;

    gl_FragColor = vec4(fragColor, 1.0);
  }
  `;
}
