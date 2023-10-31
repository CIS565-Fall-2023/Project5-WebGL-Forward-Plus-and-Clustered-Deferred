#version 100
#extension GL_EXT_draw_buffers : enable

precision highp float;

uniform sampler2D u_texture;
uniform bool u_horizontal;
uniform vec2 u_resolution;  
varying vec2 v_uv;

void main() {
    // Declaring the kernel array without using an initializer
    float kernel[5];
    kernel[0] = 0.227027;
    kernel[1] = 0.1945946;
    kernel[2] = 0.1216216;
    kernel[3] = 0.054054;
    kernel[4] = 0.016216;

    vec3 blurredColor = texture2D(u_texture, v_uv).rgb * kernel[0];
    vec2 offset = u_horizontal ? vec2(1.0 / u_resolution.x, 0.0) : vec2(0.0, 1.0 / u_resolution.y);  // Fixed resolution variable
    for (int i = 1; i < 5; ++i) {
        blurredColor += texture2D(u_texture, v_uv + float(i) * offset).rgb * kernel[i];
        blurredColor += texture2D(u_texture, v_uv - float(i) * offset).rgb * kernel[i];
    }
    gl_FragColor = vec4(blurredColor, 1.0);
}
