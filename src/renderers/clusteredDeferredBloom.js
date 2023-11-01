import { gl, WEBGL_draw_buffers, canvas } from '../init';
import { mat4, vec2 } from 'gl-matrix';
import { loadShaderProgram, renderFullscreenQuad } from '../utils';
import { NUM_LIGHTS } from '../scene';
import { MAX_LIGHTS_PER_CLUSTER } from './base';
import toTextureVert from '../shaders/deferredToTexture.vert.glsl';
import toTextureFrag from '../shaders/deferredToTexture.frag.glsl';
import QuadVertSource from '../shaders/quad.vert.glsl';
import fsSource from '../shaders/deferred.frag.glsl.js';
import TextureBuffer from './textureBuffer';
import BaseRenderer from './base';
import BrightnessFrag from '../shaders/brightness.frag.glsl';
import BlurFrag from '../shaders/blur.frag.glsl';

export const NUM_GBUFFERS = 4;

export default class ClusteredDeferredBloomRenderer extends BaseRenderer {
    constructor(xSlices, ySlices, zSlices) {
        super(xSlices, ySlices, zSlices);

        this.setupDrawBuffers(canvas.width, canvas.height);

        // Create a texture to store light data
        this._lightTexture = new TextureBuffer(NUM_LIGHTS, 8);

        this._progCopy = loadShaderProgram(toTextureVert, toTextureFrag, {
            uniforms: ['u_viewProjectionMatrix', 'u_colmap', 'u_normap'],
            attribs: ['a_position', 'a_normal', 'a_uv'],
        });

        this._progShade = loadShaderProgram(QuadVertSource, fsSource({
            numLights: NUM_LIGHTS,
            maxLightsPerCluster: MAX_LIGHTS_PER_CLUSTER,
            numGBuffers: NUM_GBUFFERS,
            useBloom: true
        }), {
            uniforms: ['u_gbuffers[0]', 'u_gbuffers[1]', 'u_gbuffers[2]', 'u_gbuffers[3]', 'u_lightbuffer', 'u_clusterbuffer', 'u_xSlices', 'u_ySlices', 'u_zSlices', 'u_viewMatrix', 'u_fov', 'u_near', 'u_far', 'u_cameraAspect'],
            attribs: ['a_position', 'a_normal', 'a_uv'],
        });

        this._progBrightness = loadShaderProgram(QuadVertSource, BrightnessFrag, {
            uniforms: ['u_texture'],
            attribs: ['a_position'],
        });

        // inside constructor
        this._progBlur = loadShaderProgram(QuadVertSource, BlurFrag, {
            uniforms: ['u_texture', 'u_horizontal', 'u_resolution'],
            attribs: ['a_position'],
        });

        this._projectionMatrix = mat4.create();
        this._viewMatrix = mat4.create();
        this._viewProjectionMatrix = mat4.create();
    }

    setupDrawBuffers(width, height) {
        this._width = width;
        this._height = height;

        this._fbo = gl.createFramebuffer();
        this._deferredFBO = gl.createFramebuffer();
        // this._bloomFBO = gl.createFramebuffer();
        // this._blurFBO = gl.createFramebuffer();

        // Create, bind, and store a depth target texture for the FBO
        this._depthTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._depthTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
        gl.bindTexture(gl.TEXTURE_2D, null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._depthTex, 0);

        this._sceneTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._sceneTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, null);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._deferredFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._sceneTexture, 0);

        // Create, bind, and store "color" target textures for the FBO
        this._gbuffers = new Array(NUM_GBUFFERS);
        let attachments = new Array(NUM_GBUFFERS);
        for (let i = 0; i < NUM_GBUFFERS; i++) {
            attachments[i] = WEBGL_draw_buffers[`COLOR_ATTACHMENT${i}_WEBGL`];
            this._gbuffers[i] = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this._gbuffers[i]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, attachments[i], gl.TEXTURE_2D, this._gbuffers[i], 0);
        }

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            throw "Framebuffer incomplete";
        }

        // Tell the WEBGL_draw_buffers extension which FBO attachments are
        // being used. (This extension allows for multiple render targets.)
        WEBGL_draw_buffers.drawBuffersWEBGL(attachments);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    resize(width, height) {
        this._width = width;
        this._height = height;

        gl.bindTexture(gl.TEXTURE_2D, this._depthTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
        for (let i = 0; i < NUM_GBUFFERS; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this._gbuffers[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    postProcess() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this._progBrightness.glShaderProgram);

        gl.activeTexture(gl.TEXTURE1);
        gl.uniform1i(this._progBrightness.u_texture, 1);

        renderFullscreenQuad(this._progBrightness);
    }

    render(camera, scene) {
        if (canvas.width != this._width || canvas.height != this._height) {
            this.resize(canvas.width, canvas.height);
        }

        // Update the camera matrices
        camera.updateMatrixWorld();
        mat4.invert(this._viewMatrix, camera.matrixWorld.elements);
        mat4.copy(this._projectionMatrix, camera.projectionMatrix.elements);
        mat4.multiply(this._viewProjectionMatrix, this._projectionMatrix, this._viewMatrix);

        // Render to the whole screen
        gl.viewport(0, 0, canvas.width, canvas.height);

        // Bind the framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this._progCopy.glShaderProgram);
        gl.uniformMatrix4fv(this._progCopy.u_viewProjectionMatrix, false, this._viewProjectionMatrix);
        scene.draw(this._progCopy);

        // Update the buffer used to populate the texture packed with light data
        for (let i = 0; i < NUM_LIGHTS; ++i) {
            this._lightTexture.buffer[this._lightTexture.bufferIndex(i, 0) + 0] = scene.lights[i].position[0];
            this._lightTexture.buffer[this._lightTexture.bufferIndex(i, 0) + 1] = scene.lights[i].position[1];
            this._lightTexture.buffer[this._lightTexture.bufferIndex(i, 0) + 2] = scene.lights[i].position[2];
            this._lightTexture.buffer[this._lightTexture.bufferIndex(i, 0) + 3] = scene.lights[i].radius;

            this._lightTexture.buffer[this._lightTexture.bufferIndex(i, 1) + 0] = scene.lights[i].color[0];
            this._lightTexture.buffer[this._lightTexture.bufferIndex(i, 1) + 1] = scene.lights[i].color[1];
            this._lightTexture.buffer[this._lightTexture.bufferIndex(i, 1) + 2] = scene.lights[i].color[2];
        }
        // Update the light texture
        this._lightTexture.update();

        // Update the clusters for the frame
        this.updateClusters(camera, this._viewMatrix, scene);

        // Bind the default null framebuffer which is the screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._deferredFBO);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this._progShade.glShaderProgram);

        // Set the light texture as a uniform input to the shader
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this._lightTexture.glTexture);
        gl.uniform1i(this._progShade.u_lightbuffer, 2);

        // Set the cluster texture as a uniform input to the shader
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this._clusterTexture.glTexture);
        gl.uniform1i(this._progShade.u_clusterbuffer, 3);

        // Bind g-buffers
        const firstGBufferBinding = 4; // You may have to change this if you use other texture slots
        for (let i = 0; i < NUM_GBUFFERS; i++) {
            gl.activeTexture(gl[`TEXTURE${i + firstGBufferBinding}`]);
            gl.bindTexture(gl.TEXTURE_2D, this._gbuffers[i]);
            gl.uniform1i(this._progShade[`u_gbuffers[${i}]`], i + firstGBufferBinding);
        }

        // TODO: Bind any other shader inputs
        gl.uniform1f(this._progShade.u_xSlices, this._xSlices);
        gl.uniform1f(this._progShade.u_ySlices, this._ySlices);
        gl.uniform1f(this._progShade.u_zSlices, this._zSlices);
        gl.uniformMatrix4fv(this._progShade.u_viewMatrix, false, this._viewMatrix);
        gl.uniform1f(this._progShade.u_fov, camera.fov);
        gl.uniform1f(this._progShade.u_near, camera.near);
        gl.uniform1f(this._progShade.u_far, camera.far);
        gl.uniform1f(this._progShade.u_cameraAspect, camera.aspect);

        // renderFullscreenQuad(this._progShade);
        this.postProcess();
    }
};
