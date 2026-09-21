vec4 applyTint(vec4 texture)
{
    vec3 unpremultTexture = texture.rgb / texture.a;
    float alpha = texture.a * outTint.a;
    vec3 color = vec3(unpremultTexture);

    if (outTintEffect == 0.0) {
        // Multiply texture tint
        color *= outTint.bgr;
    }
    else if (outTintEffect == 1.0) {
        // Solid color + texture alpha
        color = outTint.bgr;
    }
    else if (outTintEffect == 2.0) {
        // Additive tint
        color += outTint.bgr;
    }
    else if (outTintEffect == 4.0) {
        // Screen tint
        color = 1.0 - (1.0 - unpremultTexture) * (1.0 - outTint.bgr);
    }
    else if (outTintEffect == 5.0) {
        // Overlay tint
        color = vec3(
            unpremultTexture.r < 0.5 ? 2.0 * outTint.b * unpremultTexture.r : 1.0 - 2.0 * (1.0 - outTint.b) * (1.0 - unpremultTexture.r),
            unpremultTexture.g < 0.5 ? 2.0 * outTint.g * unpremultTexture.g : 1.0 - 2.0 * (1.0 - outTint.g) * (1.0 - unpremultTexture.g),
            unpremultTexture.b < 0.5 ? 2.0 * outTint.r * unpremultTexture.b : 1.0 - 2.0 * (1.0 - outTint.r) * (1.0 - unpremultTexture.b)
        );
    }
    else if (outTintEffect == 6.0) {
        // Hard light tint
        color = vec3(
            outTint.b < 0.5 ? 2.0 * outTint.b * unpremultTexture.r : 1.0 - 2.0 * (1.0 - outTint.b) * (1.0 - unpremultTexture.r),
            outTint.g < 0.5 ? 2.0 * outTint.g * unpremultTexture.g : 1.0 - 2.0 * (1.0 - outTint.g) * (1.0 - unpremultTexture.g),
            outTint.r < 0.5 ? 2.0 * outTint.r * unpremultTexture.b : 1.0 - 2.0 * (1.0 - outTint.r) * (1.0 - unpremultTexture.b)
        );
    }

    return vec4(color * alpha, alpha);
}
