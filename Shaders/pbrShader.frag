#version 330 core
out vec4 FragColor;

#define NR_POINT_LIGHTS 4

in vec3 FragPos;
in vec3 Normal;
in vec2 TexCoords;
in mat3 TBN;

struct Light
{
	vec3 position;
	vec3 color;
};

uniform Light lights[4];
uniform vec3 camPos;
uniform sampler2D normalTex;
uniform sampler2D diffuseTex;
uniform sampler2D roughnessTex;
uniform sampler2D metalnessTex;

uniform sampler2D texture_diffuse0;

uniform float roughnessF;
uniform float metalnessF;
uniform float fader;

uniform bool useTex;

//from learnopengl
float DistributionGGX(vec3 N, vec3 H, float a)
{
	a = a * a; //adding because apparently roughness should be squared according to disney and epic
	float a2, NdotH, NdotH2, num, denom;
	a2 = a * a;
	NdotH = max(dot(N, H), 0.0f);
	NdotH2 = NdotH * NdotH;

	num = a2;
	denom = 3.14159 * pow((NdotH2 * (a2 - 1.0f) + 1.0f), 2.0f);
	return num / max(denom, .001);
}

//from the epic games slides --- I prefer this one
float DistributionGGX1(vec3 N, vec3 H, float a)
{
	a = a * a; //adding because apparently roughness should be squared according to disney and epic
	float a2, NdotH, NdotH2, num, denom;
	a2 = a * a;
	NdotH = max(dot(N, H), 0.0f);
	NdotH2 = NdotH * NdotH;

	num = a2;
	denom = 3.14159 * pow((pow(NdotH2, 2.0f) * (a2 - 1.0f) + 1.0f), 2.0f);
	return num / max(denom, .001);
}

//normal, view, and roughness alpha
float GeometrySchlickGGX(vec3 N, vec3 v, float a)
{
	a = a * a; //adding because apparently roughness should be squared according to disney and epic
	float k, NdotV;
	k = pow(a + 1, 2) / 8.0f; //remaps differently if we do IBL --- becomes (a^2)/2
	NdotV = max(dot(N, v), 0.0f);

	return NdotV / (NdotV * (1 - k) + k);
}

//normal, view, light (to/from surface) and alpha
float GeometrySmith(vec3 N, vec3 v, vec3 l, float a)
{
	a = a * a; //adding because apparently roughness should be squared according to disney and epic
	return GeometrySchlickGGX(N, v, a) * GeometrySchlickGGX(N, l, a);
}

//incidence angle (from dot product of normal and halfway vector, index of refraction
float FresnelSchlick(float VdotH, float ior)
{
	float F0 = pow((ior - 1) / (ior + 1), 2.0f);
	//float F0 = .04;
	return F0 + (1.0 - F0) * pow(clamp(1.0 - VdotH, 0.0f, 1.0f), 5.0);
}

//the epic games version. Indistinguishable from regular schlick approx.
float FresnelSchlick1(float VdotH, float ior)
{
	float F0 = pow((ior - 1) / (ior + 1), 2.0f);
	return F0 + (1.0 - F0) * pow(2.0f, (-5.55473*VdotH-6.98316)*VdotH);
}

float Attenuate(vec3 lightPos, vec3 surface)
{
	return 1.0f / pow(length(lightPos-surface), 2.0f) ;
}

float Radiance(vec3 surface, vec3 lightPos, vec3 N)
{
	vec3 wi = normalize(lightPos - surface);
	float cosTheta = max(dot(N, wi), 0.0f);
	float attenuation = Attenuate(lightPos, surface);
	return attenuation * cosTheta;
}

//returns the normal for this fragment
vec3 mapNormal()
{
	vec3 normal = texture(normalTex, TexCoords).rgb;
	normal = normal * 2.0f - 1.0f;

	return normalize(TBN * normal);
}

//for when the texture compression throws away the blue channel and it needs to be reconstructed
vec3 mapNormalNoBlue()
{
	vec3 normal = texture(normalTex, TexCoords).rgb;
	normal.b = sqrt(1.0f - pow(texture(normalTex, TexCoords).r, 2.0f) - pow(texture(normalTex, TexCoords).g, 2.0f));
	normal = normal * 2.0f - 1.0f;
	
	return normalize(TBN * normal);
}

//can pass in text coords and get white noise texture.
float random (vec2 st) {
    return fract(sin(dot(st.xy,
                         vec2(12.9898,78.233)))*
        43758.5453123);
}

void main()
{
	//lighting vectors: view is frag to camera, l is frag to light, H and N are regular halfway and normal
	vec3 v, l, H, N, final;

	//pbr texture values
	float roughness, metalness;

	//misc
	float pi=3.1415926, num, denom, NdotL;
	vec3 F, Lo;

	//D: microfacet roughness normal distribution, G: microfacet self shadowing, f: fresnel
	float D, G, f;

	//specular and diffuse ratio values, total specular, radiance
	vec3 kS, kD, spec, radiance;
	
	for(int i=0; i<4; i++)
	{

		v = normalize(camPos - FragPos);
		l = normalize(lights[i].position - FragPos);
		H = normalize(l + v);
		N = mapNormal();
	
		if(!useTex){N = mapNormal();}

		roughness = texture(roughnessTex, TexCoords).x;
		metalness = 1 - texture(metalnessTex, TexCoords).x;
		//metalness = .04f;
	
		radiance = fader * lights[i].color * Attenuate(lights[i].position, FragPos);
	
		
		D = DistributionGGX1(N, H, roughness);
		G = 1.0f / pow(max(dot(l, H), .001f), 2.0f);
		f = FresnelSchlick1(max(dot(H, N), 0.0f), metalness);
	
		F = vec3(f);
		kS = F;
		kD = vec3(1.0f) - kS;
		spec = (D * G * F) / 4.0f;

		NdotL = max(dot(N, l), 0.0f);
		Lo = (kD * vec3(texture(diffuseTex, TexCoords)) / pi + spec) * radiance * NdotL;

		final += Lo;
	}

	//gamma correction
	vec3 mapped = final / (final + vec3(1.0)); //why is this the value for mapped?
	mapped = pow(mapped, vec3(1.0 / 2.2));
	FragColor = vec4(mapped, texture(diffuseTex, TexCoords).a);

/*	if(!useTex)
	{
		FragColor = vec4(0.0f);
		for(int i=0; i < 4; i++)
		{
			v = normalize(camPos - FragPos);
			l = normalize(lights[i].position - FragPos);
			H = normalize(l + v);
			N = mapNormal();
			FragColor += vec4(texture(diffuseTex, TexCoords).rgb * max(0, dot(N, l)) + lights[i].color * pow(max(0, dot(N, H)), 100), 1.0f);
		}
	}*/
}

//Note: For some blender models the normals are exported incorrectly, so export as .obj and uncheck "write normals"
//in the geometry dropdown. Assimp is setup to create normals, tangents, and bitangents in this project


//quick phong: texture(diffuseTex, TexCoords).rgb * fader * max(0, dot(N, l)) + lights[i].color * fader * pow(max(0, dot(N, H)), 100);